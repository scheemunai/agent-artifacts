import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import pino from 'pino';
import { type AppConfig, loadConfig } from '../../src/config.js';
import type { SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Account, CloudModule } from '../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { AppError, errorEnvelope, internalErrorEnvelope } from '../../src/lib/errors.js';
import { globalRateLimitStore } from '../../src/lib/rate-limit.js';
import type { Logger } from '../../src/logger.js';
import { registerV1Routes } from '../../src/routes/v1/index.js';
import { type CreatedBot, createBot } from '../../src/services/bots.js';

interface TestVariables {
  requestId: string;
  logger: Logger;
}

export interface ApiTestContext {
  app: Hono<{ Variables: TestVariables }>;
  config: AppConfig;
  db: SqliteDatabaseHandle;
  account: Account;
  bot: CreatedBot;
  apiKey: string;
  authHeaders: Record<string, string>;
  cleanup(): Promise<void>;
}

export interface CreateApiTestContextOptions {
  cloudModule?: CloudModule;
  rateLimitsDisabled?: boolean;
  maxContentBytes?: number;
  baseUrl?: string;
  suspended?: boolean;
}

export async function createApiTestContext(
  options: CreateApiTestContextOptions = {}
): Promise<ApiTestContext> {
  globalRateLimitStore.reset();

  const cwd = mkdtempSync(join(tmpdir(), 'aa-api-'));
  const config = loadConfig(
    {
      DEPLOYMENT: 'self-hosted',
      BASE_URL: options.baseUrl ?? 'https://example.test',
      AA_SQLITE_PATH: './data/app.db',
      AA_RATE_LIMITS_DISABLED: String(options.rateLimitsDisabled ?? true),
      ...(options.maxContentBytes !== undefined
        ? { AA_MAX_CONTENT_BYTES: String(options.maxContentBytes) }
        : {}),
      LOG_LEVEL: 'error',
    },
    { cwd }
  );

  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db: SqliteDatabaseHandle = {
    dialect: 'sqlite',
    sqlite,
    db: drizzle(sqlite),
    close: () => {
      sqlite.close();
    },
  };
  const logger = pino({ enabled: false });
  await runMigrations(db, logger);

  const cloudModule = options.cloudModule ?? createDefaultCloudModule(config);
  const account: Account = {
    id: `acc_${nanoid(21)}`,
    email: `agent-${nanoid(8)}@example.test`,
    suspendedAt: options.suspended ? Date.now() : null,
  };
  insertAccount(db, account);
  const bot = await createBot({
    db,
    extension: cloudModule,
    account,
    name: 'Test Bot',
    byline: 'Route test bot',
  });

  const app = createV1OnlyApp({ config, logger, db, cloudModule });

  return {
    app,
    config,
    db,
    account,
    bot,
    apiKey: bot.apiKey,
    authHeaders: { Authorization: `Bearer ${bot.apiKey}` },
    cleanup: async () => {
      await db.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export function createV1OnlyApp(input: {
  config: AppConfig;
  logger?: Logger;
  db?: SqliteDatabaseHandle;
  cloudModule?: CloudModule;
}): Hono<{ Variables: TestVariables }> {
  const logger = input.logger ?? pino({ enabled: false });
  const app = new Hono<{ Variables: TestVariables }>();

  app.use('*', async (context, next) => {
    context.set('requestId', 'req_test');
    context.set('logger', logger);
    await next();
    context.header('X-Content-Type-Options', 'nosniff');
    if (input.config.secureCookies) {
      context.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
  });

  registerV1Routes(app, {
    config: input.config,
    logger,
    ...(input.db ? { db: input.db } : {}),
    ...(input.cloudModule ? { cloudModule: input.cloudModule } : {}),
  });

  app.notFound((context) =>
    context.json({ error: { code: 'not_found', message: 'Not found' } }, 404)
  );

  app.onError((error, context) => {
    if (error instanceof AppError) {
      for (const [name, value] of Object.entries(error.headers)) {
        context.header(name, value);
      }
      return context.json(errorEnvelope(error, context.get('requestId')), error.status);
    }

    return context.json(internalErrorEnvelope(context.get('requestId')), 500);
  });

  return app;
}

export async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

export function insertAccount(db: SqliteDatabaseHandle, account: Account): void {
  const now = Date.now();
  db.sqlite
    .prepare(
      `
        INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `
    )
    .run(account.id, account.email, account.suspendedAt, now, now);
}

export function countRows(db: SqliteDatabaseHandle, table: string): number {
  const row = db.sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}
