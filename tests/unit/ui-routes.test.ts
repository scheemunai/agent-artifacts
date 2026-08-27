import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'aa-ui-routes-'));
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
    },
    { cwd }
  );
  return createApp({ config, logger: pino({ enabled: false }) });
}

describe('web UI routes', () => {
  it('redirects self-hosted root to setup placeholder', async () => {
    const app = testApp();
    const response = await app.request('https://example.test/');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/setup');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('renders the style guide with app-origin CSP and no CDN references', async () => {
    const app = testApp();
    const response = await app.request('https://example.test/style-guide');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    );
    expect(html).toContain('UI Foundation');
    expect(html).toContain('aa-md');
    expect(html).not.toMatch(/https?:\/\/(cdn|unpkg|jsdelivr|fonts\.googleapis)/i);
  });

  it('renders login and setup placeholders for M4-owned auth pages', async () => {
    const app = testApp();
    const setup = await app.request('https://example.test/setup');
    const login = await app.request('https://example.test/login');

    expect(setup.status).toBe(200);
    expect(await setup.text()).toContain('Setup is coming next');
    expect(login.status).toBe(200);
    expect(await login.text()).toContain('Login is coming next');
  });
});
