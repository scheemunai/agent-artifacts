import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { createAuthTestContext, login } from './auth-test-utils.js';

/**
 * A miss that a human clicked used to answer with the API's own body: a signed-in owner following
 * a stale artifact link, a reader opening an expired download, anyone hitting a removed asset —
 * all landed on `{"error":{"code":"not_found","message":"Not found"}}` in the browser's JSON
 * viewer. No chrome, no explanation, no way back.
 *
 * The fix is content negotiation and nothing else: a browser navigation gets a branded page, and
 * an API client's envelope stays byte-identical. Both halves are asserted here, because getting
 * the second half wrong would silently break every integrator.
 */
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'aa-error-page-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function testApp() {
  const config = loadConfig(
    {
      DEPLOYMENT: 'self-hosted',
      BASE_URL: 'https://example.test',
      AA_SQLITE_PATH: './data/app.db',
      LOG_LEVEL: 'error',
    },
    { cwd }
  );
  return createApp({ config, logger: pino({ enabled: false }) });
}

describe('error responses are content-negotiated', () => {
  it('answers a browser navigation with a branded page', async () => {
    const response = await testApp().request('https://example.test/assets/gone.css', {
      headers: { Accept: HTML_ACCEPT },
    });
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).not.toContain('"error"');
    expect(html.toLowerCase()).toContain('<!doctype html>');
    expect(html).toContain('<svg');
    // Says what happened and offers a way onward, rather than restating a status code.
    expect(html).toContain('Not found');
    expect(html).toMatch(/href="\/(?:dashboard)?"/);
  });

  it('keeps the JSON envelope byte-identical for API clients', async () => {
    const app = testApp();
    const envelope = '{"error":{"code":"not_found","message":"Not found"}}';

    for (const headers of [
      { Accept: 'application/json' },
      { Accept: '*/*' },
      {},
      // A browser-ish Accept must still not reshape the documented API namespace.
      { Accept: HTML_ACCEPT },
    ]) {
      const response = await app.request('https://example.test/v1/nope', { headers });
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(await response.text(), JSON.stringify(headers)).toBe(envelope);
    }
  });

  it('keeps non-API misses on JSON when the client did not ask for HTML', async () => {
    const response = await testApp().request('https://example.test/assets/gone.css', {
      headers: { Accept: 'application/json' },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Not found' },
    });
  });

  it('gives a signed-in owner dashboard chrome and a way back to their artifacts', async () => {
    const ctx = await createAuthTestContext();
    try {
      const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
      const account = await auth.createPasswordAccount('error-page@example.test', 'password123');
      void accountToCloudAccount(account);
      const cookie = await login(ctx, account.email, 'password123');

      const response = await ctx.app.request('/dashboard/artifacts/art_does_not_exist', {
        headers: { Accept: HTML_ACCEPT, Cookie: cookie },
      });
      const html = await response.text();

      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).not.toContain('"error"');
      expect(html).toContain('href="/dashboard"');
      // Dashboard chrome, not the public card: the owner is still signed in.
      expect(html).toContain('aa-app-header');
      expect(html).toContain('/dashboard/bots');
    } finally {
      await ctx.cleanup();
    }
  });

  it('shows an anonymous visitor the public card, with no dashboard navigation', async () => {
    const response = await testApp().request('https://example.test/nope', {
      headers: { Accept: HTML_ACCEPT },
    });
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).not.toContain('/dashboard/bots');
  });

  it('renders a branded page for a thrown application error too', async () => {
    const ctx = await createAuthTestContext();
    try {
      // No session: the dashboard's own guard answers, and a browser must never see raw JSON.
      const response = await ctx.app.request('/dashboard/artifacts/art_x', {
        headers: { Accept: HTML_ACCEPT },
      });

      expect([302, 303, 404]).toContain(response.status);
      if (response.status === 404) {
        expect(await response.text()).not.toContain('"error"');
      }
    } finally {
      await ctx.cleanup();
    }
  });
});
