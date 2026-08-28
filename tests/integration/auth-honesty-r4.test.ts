import { renderToString } from 'hono/jsx/dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { LoginPage } from '../../src/ui/pages/login.js';
import { SetupPage } from '../../src/ui/pages/setup.js';
import { type AuthTestContext, createAuthTestContext, formBody } from './auth-test-utils.js';

const contexts: AuthTestContext[] = [];

afterEach(async () => {
  while (contexts.length > 0) {
    await contexts.pop()?.cleanup?.();
  }
});

async function makeAuthContext({ env }: { env?: Record<string, string> } = {}) {
  const ctx = await createAuthTestContext(env);
  contexts.push(ctx);
  return ctx;
}

const BASE = 'https://example.test';

/**
 * A-21. A POST asking for magic-link sign-in on an instance with no mail transport fell through to
 * the password branch with an empty password, so it answered 401 with a credential error — for a
 * request that offered no credentials and failed for an unrelated reason.
 */
describe('A-21 · an unavailable sign-in mode says so', () => {
  it('does not answer 401 to a request that offered no credentials', async () => {
    const ctx = await makeAuthContext({ env: { DEPLOYMENT: 'self-hosted' } });

    const response = await ctx.app.request('/login', {
      method: 'POST',
      ...formBody({ mode: 'magic', email: 'ops@example.test' }),
    });

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(400);
  });

  it('names the real cause instead of a credential failure', async () => {
    const ctx = await makeAuthContext({ env: { DEPLOYMENT: 'self-hosted' } });

    const response = await ctx.app.request('/login', {
      method: 'POST',
      ...formBody({ mode: 'magic', email: 'ops@example.test' }),
    });
    const html = await response.text();

    expect(html).toMatch(/magic-link sign-in is not enabled/i);
    // The password error asserts something that did not happen.
    expect(html).not.toMatch(/email or password/i);
    // and it still offers the way in that does work
    expect(html).toContain('name="password"');
  });

  it('keeps the typed email so the working path is one field away', async () => {
    const ctx = await makeAuthContext({ env: { DEPLOYMENT: 'self-hosted' } });

    const response = await ctx.app.request('/login', {
      method: 'POST',
      ...formBody({ mode: 'magic', email: 'ops@example.test' }),
    });

    expect(await response.text()).toContain('value="ops@example.test"');
  });

  it('still signs in by magic link where mail is configured', async () => {
    // Mail must actually be configured for this branch to mean anything; without a transport the
    // route fails to send and 503s, which is a different (correct) answer to a different question.
    const ctx = await makeAuthContext({
      env: { DEPLOYMENT: 'cloud', AA_MAIL_TRANSPORT: 'log' },
    });

    const response = await ctx.app.request('/login', {
      method: 'POST',
      ...formBody({ mode: 'magic', email: 'ops@example.test' }),
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('Check your email');
    expect(html).not.toMatch(/not enabled/i);
  });
});

/** A-42. A URL is not a status. */
describe('A-42 · the setup base URL is not wearing a status costume', () => {
  it('does not render the instance URL as a Badge', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));

    expect(html).not.toMatch(new RegExp(`aa-badge[^>]*>[^<]*${BASE.replace(/\//g, '\\/')}`));
    expect(html).not.toContain(`<span class="aa-badge aa-badge--info">${BASE}</span>`);
  });

  it('still shows which instance is being set up, as a fact rather than a state', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));

    expect(html).toContain(BASE);
    expect(html).toMatch(/<code[^>]*>https:\/\/example\.test<\/code>/);
  });
});

/** N-3. Masking a one-time boot token defends nothing and hides transcription errors. */
describe('N-3 · the setup token is legible while it is being transcribed', () => {
  it('is not masked', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));
    const tag = /<input[^>]*id="setup_token"[^>]*>/.exec(html)?.[0] ?? '';

    expect(tag).not.toContain('type="password"');
    expect(tag).toContain('type="text"');
  });

  it('keeps the one-time-code vocabulary that stops manager capture', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));
    const tag = /<input[^>]*id="setup_token"[^>]*>/.exec(html)?.[0] ?? '';

    expect(tag).toContain('autocomplete="one-time-code"');
  });
});

/**
 * A-39 (login half) and the N-3 residual, closed now that F2's props exist (964a677).
 */
describe('A-39 · the login form is ready to type into', () => {
  it('focuses the email field, which is the first actionable field in both modes', () => {
    for (const mode of ['password', 'magic'] as const) {
      const html = renderToString(LoginPage({ mode, mailAvailable: true }));
      const email = /<input[^>]*id="email"[^>]*>/.exec(html)?.[0] ?? '';

      expect(email).toContain('autofocus');
    }
  });

  it('autofocuses exactly one field, and never the password box', () => {
    const html = renderToString(LoginPage({ mode: 'password', mailAvailable: true }));

    expect((html.match(/autofocus/g) ?? []).length).toBe(1);
    const password = /<input[^>]*id="password"[^>]*>/.exec(html)?.[0] ?? '';
    expect(password).not.toContain('autofocus');
  });

  it('gives the password box a reveal with a real control and an action label', () => {
    const html = renderToString(LoginPage({ mode: 'password', mailAvailable: true }));

    expect(html).toContain('data-aa-password-toggle="password"');
    // The label names what the control will do, not the state it is in.
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
    // A bordered 44px control, not a bare glyph beside a field.
    expect(html).toContain('aa-btn--secondary');
    expect(html).toContain('aa-btn--icon');
    // and the vocabulary from the last batch survives the swap
    expect(html).toContain('autocomplete="current-password"');
  });

  it('reveals both setup password boxes without disturbing their vocabulary', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));

    expect(html).toContain('data-aa-password-toggle="password"');
    expect(html).toContain('data-aa-password-toggle="password_confirm"');
    expect((html.match(/autocomplete="new-password"/g) ?? []).length).toBe(2);
  });

  it('keeps a field error attached after the swap', () => {
    const html = renderToString(
      SetupPage({
        baseUrl: BASE,
        error: 'Password must be at least 8 characters',
        errorField: 'password',
      })
    );

    expect(html).toContain('id="password-error"');
    expect(html).toMatch(/id="password"[^>]*aria-invalid="true"/);
  });
});

describe('N-3 residual · the setup token survives mobile input assistance', () => {
  it('is not autocapitalized, corrected or spellchecked', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));
    const tag = /<input[^>]*id="setup_token"[^>]*>/.exec(html)?.[0] ?? '';

    // iOS defaults text inputs to autocapitalize=sentences, which would uppercase the first
    // character of a token that is case-sensitive and single-use.
    expect(tag).toContain('autocapitalize="none"');
    expect(tag).toContain('autocorrect="off"');
    expect(tag).toMatch(/spellcheck="?false"?/);
  });
});
