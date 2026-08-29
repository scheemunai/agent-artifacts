import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/config.js';
import {
  createWaitlistService,
  isValidWaitlistEmail,
  normalizeWaitlistEmail,
  WaitlistError,
} from '../../src/services/waitlist.js';

const logger = pino({ enabled: false });

const AUDIENCE = 'aud_test';

function config(
  overrides: Partial<AppConfig['waitlist']> = {}
): Pick<AppConfig, 'waitlist' | 'mail'> {
  return {
    waitlist: {
      audienceId: AUDIENCE,
      apiKey: 'key_audience',
      from: 'Agent Artifacts <hello@agentartifact.ai>',
      confirmation: true,
      ...overrides,
    },
    mail: { transport: 'resend', smtpPort: 587, resendApiKey: 'key_sending' },
  };
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/**
 * A Resend stand-in that answers the two endpoints this service uses, recording every call.
 * `existing` seeds the audience, so the de-dupe path is exercised rather than described.
 */
function fakeResend(options: { existing?: string[]; contactStatus?: number } = {}) {
  const calls: Call[] = [];
  const existing = new Set(options.existing ?? []);

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    if (url.includes('/audiences/') && method === 'GET') {
      const email = decodeURIComponent(url.split('/contacts/')[1] ?? '');
      return existing.has(email)
        ? new Response(JSON.stringify({ object: 'contact', id: 'c_1' }), { status: 200 })
        : new Response(JSON.stringify({ message: 'Contact not found' }), { status: 404 });
    }

    if (url.includes('/audiences/') && method === 'POST') {
      const status = options.contactStatus ?? 201;
      return new Response(JSON.stringify({ object: 'contact', id: 'c_1' }), { status });
    }

    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  }) as unknown as typeof fetch;

  return { calls, fetchImpl };
}

describe('waitlist email validation', () => {
  it('accepts ordinary addresses, in whatever case they were typed', () => {
    expect(isValidWaitlistEmail('ada@example.com')).toBe(true);
    expect(isValidWaitlistEmail('  Ada.Lovelace+list@Example.co.uk  ')).toBe(true);
    expect(normalizeWaitlistEmail('  Ada@Example.COM ')).toBe('ada@example.com');
  });

  it('rejects the junk a public form actually receives', () => {
    for (const junk of [
      '',
      '   ',
      'ada',
      'ada@',
      '@example.com',
      'ada@example',
      'ada @example.com',
      'ada@exam ple.com',
      'ada@@example.com',
      'ada..lovelace@example.com',
      '<script>alert(1)</script>@example.com',
      `${'a'.repeat(65)}@example.com`,
      `ada@${'a'.repeat(250)}.com`,
    ]) {
      expect(isValidWaitlistEmail(junk), `${junk || '(blank)'} was accepted`).toBe(false);
    }
  });
});

describe('subscribing to the audience', () => {
  it('adds a new contact and sends exactly one confirmation', async () => {
    const resend = fakeResend();
    const service = createWaitlistService(config(), logger, { fetch: resend.fetchImpl });

    expect(await service.subscribe('  Ada@Example.TEST ')).toBe('subscribed');

    const writes = resend.calls.filter((call) => call.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[0]?.url).toBe(`https://api.resend.com/audiences/${AUDIENCE}/contacts`);
    expect(writes[0]?.body).toEqual({ email: 'ada@example.test', unsubscribed: false });
    expect(writes[1]?.url).toBe('https://api.resend.com/emails');
    expect(writes[1]?.body).toMatchObject({
      to: ['ada@example.test'],
      subject: "You're on the Agent Artifacts waitlist",
    });
  });

  it('takes a repeat signup quietly, and does NOT mail the address a second time', async () => {
    // The whole point of the pre-write lookup. Resend's contact write is idempotent, so without it
    // a form anyone can submit becomes a way to mail a stranger once per submission.
    const resend = fakeResend({ existing: ['ada@example.test'] });
    const service = createWaitlistService(config(), logger, { fetch: resend.fetchImpl });

    expect(await service.subscribe('ada@example.test')).toBe('already_subscribed');
    expect(resend.calls.filter((call) => call.url.endsWith('/emails'))).toHaveLength(0);
  });

  it('treats a 409 from the audience as already on the list', async () => {
    const resend = fakeResend({ contactStatus: 409 });
    const service = createWaitlistService(config(), logger, { fetch: resend.fetchImpl });

    expect(await service.subscribe('ada@example.test')).toBe('already_subscribed');
  });

  it('reports upstream failure rather than claiming a signup that did not happen', async () => {
    const resend = fakeResend({ contactStatus: 422 });
    const service = createWaitlistService(config(), logger, { fetch: resend.fetchImpl });

    await expect(service.subscribe('ada@example.test')).rejects.toMatchObject({
      reason: 'upstream',
    });
    expect(resend.calls.filter((call) => call.url.endsWith('/emails'))).toHaveLength(0);
  });

  it('rejects a bad address before it costs a request', async () => {
    const resend = fakeResend();
    const service = createWaitlistService(config(), logger, { fetch: resend.fetchImpl });

    await expect(service.subscribe('not-an-email')).rejects.toBeInstanceOf(WaitlistError);
    expect(resend.calls).toHaveLength(0);
  });

  it('is disabled, and says so, when no audience is configured', async () => {
    const resend = fakeResend();
    const service = createWaitlistService(
      { ...config(), waitlist: { from: 'x@y.test', confirmation: true } },
      logger,
      { fetch: resend.fetchImpl }
    );

    expect(service.enabled).toBe(false);
    await expect(service.subscribe('ada@example.test')).rejects.toMatchObject({
      reason: 'not_configured',
    });
    expect(resend.calls).toHaveLength(0);
  });

  it('stores the contact even when the confirmation cannot be sent', async () => {
    // The signup already succeeded by the time the mail goes out. A mail failure must not tell the
    // visitor to try again — they are on the list.
    const resend = fakeResend();
    const service = createWaitlistService(
      { ...config(), mail: { transport: 'log', smtpPort: 587 } },
      logger,
      { fetch: resend.fetchImpl }
    );

    expect(await service.subscribe('ada@example.test')).toBe('subscribed');
    expect(resend.calls.filter((call) => call.url.endsWith('/emails'))).toHaveLength(0);
  });

  it('does not send a confirmation when the deployment turned it off', async () => {
    const resend = fakeResend();
    const service = createWaitlistService(config({ confirmation: false }), logger, {
      fetch: resend.fetchImpl,
    });

    expect(await service.subscribe('ada@example.test')).toBe('subscribed');
    expect(resend.calls.filter((call) => call.url.endsWith('/emails'))).toHaveLength(0);
  });
});
