import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type AuthTestContext, createAuthTestContext, formBody } from './auth-test-utils.js';

let contexts: AuthTestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.map((ctx) => ctx.cleanup()));
  contexts = [];
});

/**
 * A live setup token, read the way the operator reads it — out of the file the server writes on
 * boot. Never a literal: the one-time token is the kind of value that has no business being
 * checked in, and the release gate scans the archive for exactly that shape.
 */
async function bootSetup(): Promise<{ ctx: AuthTestContext; token: string }> {
  const ctx = await createAuthTestContext();
  contexts.push(ctx);
  await ctx.app.request('/setup');
  return { ctx, token: readFileSync(join(ctx.config.dataDir, '.setup-token'), 'utf8').trim() };
}

async function submitSetup(
  ctx: AuthTestContext,
  fields: Record<string, string>
): Promise<{ status: number; html: string }> {
  const response = await ctx.app.request('/setup', { method: 'POST', ...formBody(fields) });
  return { status: response.status, html: await response.text() };
}

function tokenFieldValue(html: string): string | null {
  return html.match(/<input[^>]*id="setup_token"[^>]*value="([^"]*)"/)?.[1] ?? null;
}

function fieldIsInvalid(html: string, field: string): boolean {
  const input = html.match(new RegExp(`<input[^>]*id="${field}"[^>]*>`))?.[0] ?? '';
  return (
    /aria-invalid="true"/.test(input) &&
    new RegExp(`aria-describedby="[^"]*${field}-error`).test(input)
  );
}

describe('A-47 · a validation slip does not cost a trip back to the boot log', () => {
  it('round-trips the submitted setup token when the password is too short', async () => {
    const { ctx, token } = await bootSetup();

    const { status, html } = await submitSetup(ctx, {
      setup_token: token,
      email: 'operator@example.test',
      password: 'short',
      password_confirm: 'short',
      bot_name: 'First Bot',
      bot_byline: 'Chief of Staff',
    });

    expect(status).toBe(400);
    // The worst field on the form to clear: a one-time value read out of a terminal.
    expect(tokenFieldValue(html)).toBe(token);
    expect(html).toContain('id="password-error"');
    expect(fieldIsInvalid(html, 'password')).toBe(true);
    // Rung 2, not rung 4: the message rides its field instead of the card.
    expect(html).not.toContain('Setup could not complete');
    // The rest of the form still survives, as it did before.
    expect(html).toContain('value="operator@example.test"');
    expect(html).toContain('value="First Bot"');
    expect(html).toContain('value="Chief of Staff"');
  });

  it('attaches a mismatch to the field the operator has to retype', async () => {
    const { ctx, token } = await bootSetup();

    const { html } = await submitSetup(ctx, {
      setup_token: token,
      email: 'operator@example.test',
      password: 'a-long-enough-password',
      password_confirm: 'a-different-password',
      bot_name: 'First Bot',
    });

    expect(tokenFieldValue(html)).toBe(token);
    expect(fieldIsInvalid(html, 'password_confirm')).toBe(true);
    expect(html).toContain('Passwords do not match');
  });

  it('attaches a missing bot name to the bot name field', async () => {
    const { ctx, token } = await bootSetup();

    const { html } = await submitSetup(ctx, {
      setup_token: token,
      email: 'operator@example.test',
      password: 'a-long-enough-password',
      password_confirm: 'a-long-enough-password',
      bot_name: '',
    });

    expect(tokenFieldValue(html)).toBe(token);
    expect(fieldIsInvalid(html, 'bot_name')).toBe(true);
  });

  it('attaches a rejected token to the token field, with what was typed still in it', async () => {
    const { ctx } = await bootSetup();

    const { status, html } = await submitSetup(ctx, {
      setup_token: 'not-the-real-token',
      email: 'operator@example.test',
      password: 'a-long-enough-password',
      password_confirm: 'a-long-enough-password',
      bot_name: 'First Bot',
    });

    expect(status).toBe(403);
    // Preserved on purpose even though it is wrong: the operator has to see what they typed to
    // find the typo in it.
    expect(tokenFieldValue(html)).toBe('not-the-real-token');
    expect(fieldIsInvalid(html, 'setup_token')).toBe(true);
  });

  it('still completes setup when the form is valid', async () => {
    const { ctx, token } = await bootSetup();

    const response = await ctx.app.request('/setup', {
      method: 'POST',
      ...formBody({
        setup_token: token,
        email: 'operator@example.test',
        password: 'a-long-enough-password',
        password_confirm: 'a-long-enough-password',
        bot_name: 'First Bot',
      }),
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('/setup/key?reveal=');
  });
});
