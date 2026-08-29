import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';

const RESEND_API = 'https://api.resend.com';

/**
 * What the signup did, from the visitor's side.
 *
 * Two outcomes rather than one because the CONFIRMATION EMAIL depends on the difference: a second
 * submit of the same address is a re-submit, not a second opt-in, and mailing it again would turn a
 * single-opt-in list into a way to spam anyone whose address you can type. The reader sees the same
 * "you're on the list" page either way — they are, and which time it is is not their concern.
 */
export type WaitlistOutcome = 'subscribed' | 'already_subscribed';

export type WaitlistFailure = 'invalid_email' | 'not_configured' | 'upstream';

export class WaitlistError extends Error {
  constructor(
    readonly reason: WaitlistFailure,
    message: string
  ) {
    super(message);
    this.name = 'WaitlistError';
  }
}

export interface WaitlistService {
  /**
   * Whether this instance has somewhere to put an address. False means the coming-soon page shows a
   * mail address instead of a form — a form that cannot store what it collects is worse than none.
   */
  readonly enabled: boolean;
  subscribe(emailInput: string): Promise<WaitlistOutcome>;
}

export interface CreateWaitlistServiceOptions {
  /** Injected in tests so the signup path is exercised without reaching Resend. */
  fetch?: typeof fetch;
}

/**
 * An address the audience will accept, lowercased and trimmed.
 *
 * `z.email()` carries the shape rule (a real local part, a dotted domain, a two-letter-plus TLD);
 * the two length bounds are the ones the RFC states and the regex does not — 254 for the whole
 * address, 64 for the local part. Both are cheap and both reject strings Resend would take and then
 * never deliver to.
 */
const waitlistEmailSchema = z
  .email()
  .max(254)
  .refine((value) => (value.split('@')[0] ?? '').length <= 64, {
    message: 'local part is longer than 64 characters',
  });

export function normalizeWaitlistEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidWaitlistEmail(input: string): boolean {
  return waitlistEmailSchema.safeParse(normalizeWaitlistEmail(input)).success;
}

export function waitlistConfirmationText(): string {
  return [
    "You're on the Agent Artifacts waitlist.",
    '',
    'Agent Artifacts gives your agent a place to publish its work: clean, versioned pages with a',
    'shareable link that stays the same as the page is updated.',
    '',
    'We will email you once — at launch. Nothing else.',
    '',
    'If this was not you, ignore this message and you will hear nothing further.',
  ].join('\n');
}

export function createWaitlistService(
  config: Pick<AppConfig, 'waitlist' | 'mail'>,
  logger: Logger,
  options: CreateWaitlistServiceOptions = {}
): WaitlistService {
  return new ResendWaitlistService(config, logger, options.fetch ?? fetch);
}

class ResendWaitlistService implements WaitlistService {
  constructor(
    private readonly config: Pick<AppConfig, 'waitlist' | 'mail'>,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.waitlist.audienceId && this.config.waitlist.apiKey);
  }

  async subscribe(emailInput: string): Promise<WaitlistOutcome> {
    const email = normalizeWaitlistEmail(emailInput);
    if (!waitlistEmailSchema.safeParse(email).success) {
      throw new WaitlistError('invalid_email', 'That does not look like an email address.');
    }

    const { audienceId, apiKey } = this.config.waitlist;
    if (!audienceId || !apiKey) {
      throw new WaitlistError('not_configured', 'The waitlist is not accepting signups here.');
    }

    // Asked BEFORE the write, because the write is idempotent and therefore cannot tell us. Resend
    // answers 201 with the same contact id whether the address is new or already present, so this
    // lookup is the only thing standing between a re-submit and a second confirmation email.
    const existed = await this.contactExists(audienceId, apiKey, email);

    const response = await this.fetchImpl(
      `${RESEND_API}/audiences/${audienceId}/contacts`,
      this.request(apiKey, { email, unsubscribed: false })
    );

    // 409 is the shape a different provider — or a future Resend — uses to say "already there".
    // Treated as success on purpose: the visitor asked to be on the list and they are on it.
    if (!response.ok && response.status !== 409) {
      this.logger.error(
        { status: response.status, ...(await readResendError(response)) },
        'waitlist.contact_failed'
      );
      throw new WaitlistError('upstream', 'We could not add you just now.');
    }

    if (existed || response.status === 409) {
      return 'already_subscribed';
    }

    await this.sendConfirmation(email);
    return 'subscribed';
  }

  private async contactExists(audienceId: string, apiKey: string, email: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(
        `${RESEND_API}/audiences/${audienceId}/contacts/${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      return response.ok;
    } catch (error) {
      // A lookup that could not be made is not an answer. Failing closed here would reject a real
      // signup over a transient network fault, so the write proceeds and the confirmation is the
      // thing that gets skipped — the recoverable half of the two.
      this.logger.warn({ err: error }, 'waitlist.contact_lookup_failed');
      return true;
    }
  }

  /**
   * The single opt-in confirmation, and the only message this list ever sends before launch.
   *
   * Never fatal. The visitor is already on the audience by the time this runs, so a mail failure
   * must not turn a successful signup into an error page telling them to try again — it is logged
   * and the signup stands.
   */
  private async sendConfirmation(email: string): Promise<void> {
    const sendKey = this.config.mail.resendApiKey;
    if (!this.config.waitlist.confirmation || !sendKey) {
      return;
    }

    try {
      const response = await this.fetchImpl(`${RESEND_API}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.waitlist.from,
          to: [email],
          subject: "You're on the Agent Artifacts waitlist",
          text: waitlistConfirmationText(),
        }),
      });

      if (!response.ok) {
        this.logger.warn(
          { status: response.status, ...(await readResendError(response)) },
          'waitlist.confirmation_failed'
        );
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'waitlist.confirmation_failed');
    }
  }

  private request(apiKey: string, body: unknown): RequestInit {
    return {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };
  }
}

/**
 * Resend's error shape is `{ statusCode, message, name }`. Every step is allowed to come back empty
 * so a proxy answering HTML turns a failed call into a thin log line rather than a parse crash.
 */
async function readResendError(
  response: Response
): Promise<{ resend_message?: string; resend_name?: string }> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) {
      return {};
    }

    const { message, name } = body as { message?: unknown; name?: unknown };
    return {
      ...(typeof message === 'string' ? { resend_message: message } : {}),
      ...(typeof name === 'string' ? { resend_name: name } : {}),
    };
  } catch {
    return {};
  }
}
