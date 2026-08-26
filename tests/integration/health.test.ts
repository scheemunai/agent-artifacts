import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'aa-health-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('GET /healthz', () => {
  it('returns the M0 health payload', async () => {
    const config = loadConfig(
      {
        DEPLOYMENT: 'self-hosted',
        BASE_URL: 'http://localhost:3000',
        AA_SQLITE_PATH: './data/app.db',
      },
      { cwd }
    );
    const app = createApp({ config, logger: pino({ enabled: false }) });

    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toMatch(/^req_[A-Za-z0-9_-]{12}$/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.json()).resolves.toEqual({ status: 'ok', version: '0.1.0' });
  });
});
