import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';
import { createApp } from '../../src/app.js';
import { type AppConfig, loadConfig } from '../../src/config.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { CloudModule } from '../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';

export interface AuthTestContext {
  app: ReturnType<typeof createApp>;
  config: AppConfig;
  db: SqliteDatabaseHandle;
  logger: Logger;
  cwd: string;
  cleanup(): Promise<void>;
}

export async function createAuthTestContext(
  env: Record<string, string> = {},
  options: { cloudModule?: CloudModule } = {}
): Promise<AuthTestContext> {
  const cwd = mkdtempSync(join(tmpdir(), 'aa-auth-'));
  const deployment = env.DEPLOYMENT ?? 'self-hosted';
  const cloudDefaults =
    deployment === 'cloud'
      ? {
          SESSION_SECRET: 'test-session-secret-with-at-least-32-bytes',
          SANDBOX_ORIGIN: 'https://usercontent.example.test',
          RESEND_API_KEY: 'resend_test_key',
        }
      : {};
  const config = loadConfig(
    {
      DEPLOYMENT: deployment,
      BASE_URL: deployment === 'cloud' ? 'https://agent.example.test' : 'http://localhost:3000',
      AA_SQLITE_PATH: './data/app.db',
      AA_RATE_LIMITS_DISABLED: 'true',
      LOG_LEVEL: 'error',
      ...cloudDefaults,
      ...env,
    },
    { cwd }
  );
  const logger = pino({ enabled: false });
  const db = (await initializeDatabase(config, logger)) as SqliteDatabaseHandle;
  await runMigrations(db, logger);
  const cloudModule = options.cloudModule ?? createDefaultCloudModule(config);
  const app = createApp({ config, logger, db, cloudModule });

  return {
    app,
    config,
    db,
    logger,
    cwd,
    cleanup: async () => {
      await db.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export function formBody(fields: Record<string, string>): {
  body: URLSearchParams;
  headers: Headers;
} {
  const body = new URLSearchParams(fields);
  const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
  return { body, headers };
}

export function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    throw new Error('Expected Set-Cookie header');
  }
  return setCookie.split(';')[0] ?? setCookie;
}

export async function login(
  ctx: AuthTestContext,
  email: string,
  password: string
): Promise<string> {
  const form = formBody({ email, password, mode: 'password' });
  const response = await ctx.app.request('/login', {
    method: 'POST',
    headers: form.headers,
    body: form.body,
  });
  if (response.status !== 303) {
    throw new Error(`Login failed with ${response.status}: ${await response.text()}`);
  }
  return cookieFrom(response);
}

export function originHeaders(ctx: AuthTestContext, cookie?: string): Headers {
  const headers = new Headers({ Origin: ctx.config.baseUrl });
  if (cookie) {
    headers.set('Cookie', cookie);
  }
  return headers;
}

export function countRows(db: SqliteDatabaseHandle, table: string): number {
  const row = db.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}
