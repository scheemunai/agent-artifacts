import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailService } from '../../src/services/mail.js';

/**
 * A failed send has to explain itself in the log.
 *
 * A live 422 from Resend cost an investigation because the warn carried only `status`: the provider
 * had said why in the response body, and the app threw that away. The classes a 422 can mean —
 * unverified sending domain, a recipient the account may not send to, a malformed field — are not
 * distinguishable from the number alone, and by the time anyone looks the request is long gone.
 *
 * What is logged is deliberately narrow: Resend's own `message` and `name`. The recipient stays
 * out, because mail events do not carry addresses today and a diagnostic improvement is not a
 * licence to widen what a log holds. Correlation to a person, if it is ever needed, is what the
 * request id is for.
 */

const RESEND_CONFIG = {
  baseUrl: 'https://example.test',
  deployment: 'cloud' as const,
  // `exactOptionalPropertyTypes` is on: an absent SMTP host is an omitted key, not an undefined one.
  mail: {
    transport: 'resend' as const,
    resendApiKey: 'test-key-not-a-secret',
    smtpFrom: 'Agent Artifacts <hello@example.test>',
    smtpPort: 587,
  },
};

/** Captures pino records without writing anywhere. */
function capturingLogger(): { logger: pino.Logger; records: Record<string, unknown>[] } {
  const records: Record<string, unknown>[] = [];
  const logger = pino(
    { level: 'warn' },
    {
      write(line: string) {
        records.push(JSON.parse(line));
      },
    }
  );
  return { logger, records };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a Resend failure', () => {
  it('logs what the provider said, not just the number it said it with', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              statusCode: 422,
              message: 'The agentartifact.ai domain is not verified.',
              name: 'validation_error',
            }),
            { status: 422, headers: { 'content-type': 'application/json' } }
          )
      )
    );

    const { logger, records } = capturingLogger();
    const mail = createMailService(RESEND_CONFIG, logger);

    await expect(
      mail.sendMagicLink({ to: 'someone@example.test', url: 'https://example.test/magic' })
    ).rejects.toThrow('Unable to send email');

    const failure = records.find((record) => record.msg === 'mail.resend_failed');
    expect(failure, 'the failure must be logged').toBeDefined();
    expect(failure?.status).toBe(422);
    expect(failure?.resend_message).toBe('The agentartifact.ai domain is not verified.');
    expect(failure?.resend_name).toBe('validation_error');
  });

  it('keeps the recipient out of the log', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'nope' }), { status: 500 }))
    );

    const { logger, records } = capturingLogger();
    const mail = createMailService(RESEND_CONFIG, logger);

    await expect(
      mail.sendMagicLink({ to: 'private@example.test', url: 'https://example.test/magic' })
    ).rejects.toThrow();

    expect(JSON.stringify(records)).not.toContain('private@example.test');
  });

  it('still fails loudly when the body is empty or not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway timeout</html>', { status: 504 }))
    );

    const { logger, records } = capturingLogger();
    const mail = createMailService(RESEND_CONFIG, logger);

    // A provider that answers with HTML must not turn a mail failure into a parse crash.
    await expect(
      mail.sendMagicLink({ to: 'someone@example.test', url: 'https://example.test/magic' })
    ).rejects.toThrow('Unable to send email');

    const failure = records.find((record) => record.msg === 'mail.resend_failed');
    expect(failure?.status).toBe(504);
    expect(failure?.resend_message).toBeUndefined();
  });
});
