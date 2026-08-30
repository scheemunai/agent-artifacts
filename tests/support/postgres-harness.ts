import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { type AppConfig, loadConfig } from '../../src/config.js';
import {
  initializeDatabase,
  type PostgresDatabaseHandle,
  type SqliteDatabaseHandle,
} from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Account, CloudModule, Plan } from '../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { globalRateLimitStore } from '../../src/lib/rate-limit.js';
import type { Logger } from '../../src/logger.js';
import {
  ArtifactService,
  type ArtifactType,
  type ArtifactWriteResult,
} from '../../src/services/artifacts.js';
import { AuthService, type BotRecord } from '../../src/services/auth.js';

export const POSTGRES_DAY_MS = 24 * 60 * 60 * 1000;
export const POSTGRES_TEST_NOW = 1_800_000_000_000;

export interface PostgresTestContext {
  cwd: string;
  config: AppConfig;
  db: PostgresDatabaseHandle;
  app: ReturnType<typeof createApp>;
  account: Account;
  bot: BotRecord;
  apiKey: string;
  cloudModule: CloudModule;
  authHeaders: Record<string, string>;
  cleanup(): Promise<void>;
}

export interface CreatePostgresTestContextOptions {
  baseUrl?: string;
  cloudModule?: CloudModule;
  logger?: Logger;
  rateLimitsDisabled?: boolean;
  artifactPurgeDays?: number;
  reset?: boolean;
}

export function postgresTestUrl(): string {
  const url = process.env.AA_TEST_DATABASE_URL;
  if (!url) {
    throw new Error('AA_TEST_DATABASE_URL must point at an isolated PostgreSQL test database');
  }
  return url;
}

export function postgresTestConfig(
  options: {
    baseUrl?: string | undefined;
    cwd?: string | undefined;
    artifactPurgeDays?: number | undefined;
    rateLimitsDisabled?: boolean | undefined;
  } = {}
): AppConfig {
  return loadConfig(
    {
      DEPLOYMENT: 'self-hosted',
      BASE_URL: options.baseUrl ?? 'https://postgres.agentartifact.example.test',
      DATABASE_URL: postgresTestUrl(),
      SESSION_SECRET: 'postgres-test-session-secret-not-secret',
      AA_RATE_LIMITS_DISABLED: String(options.rateLimitsDisabled ?? true),
      ...(options.artifactPurgeDays !== undefined
        ? { AA_ARTIFACT_PURGE_DAYS: String(options.artifactPurgeDays) }
        : {}),
      LOG_LEVEL: 'error',
    },
    { cwd: options.cwd ?? process.cwd() }
  );
}

export async function resetPostgresDatabase(url = postgresTestUrl()): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public AUTHORIZATION CURRENT_USER');
  } finally {
    await pool.end();
  }
}

export async function createPostgresTestContext(
  options: CreatePostgresTestContextOptions = {}
): Promise<PostgresTestContext> {
  globalRateLimitStore.reset();

  if (options.reset ?? true) {
    await resetPostgresDatabase();
  }

  const cwd = mkdtempSync(join(tmpdir(), 'aa-postgres-'));
  const config = postgresTestConfig({
    cwd,
    baseUrl: options.baseUrl,
    artifactPurgeDays: options.artifactPurgeDays,
    rateLimitsDisabled: options.rateLimitsDisabled,
  });
  const logger = options.logger ?? pino({ enabled: false });
  const db = (await initializeDatabase(config, logger)) as PostgresDatabaseHandle;
  await runMigrations(db, logger);

  const cloudModule = options.cloudModule ?? createDefaultCloudModule(config);
  const auth = new AuthService(db, config, logger, () => POSTGRES_TEST_NOW);
  const account = await auth.createPasswordAccount(
    `postgres-${Math.random().toString(16).slice(2)}@example.test`,
    'test-password'
  );
  const { bot, apiKey } = await auth.createBot(
    account,
    'Postgres Regression Bot',
    'Dialect test bot'
  );
  const app = createApp({ config, logger, db, cloudModule });

  return {
    cwd,
    config,
    db,
    app,
    account,
    bot,
    apiKey,
    cloudModule,
    authHeaders: { Authorization: `Bearer ${apiKey}` },
    cleanup: async () => {
      await db.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export function postgresTestCloudModule(plan: Plan): CloudModule {
  return {
    resolvePlan: async () => plan,
    checkQuota: async () => ({ allow: true }),
  };
}

export function postgresTestPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'postgres-test',
    name: 'Postgres Test',
    showFooter: true,
    limits: { maxBots: null, maxArtifacts: null },
    artifact_retention_days: null,
    ...overrides,
  };
}

export function postgresArtifactService(
  ctx: Pick<PostgresTestContext, 'db' | 'cloudModule' | 'config'>,
  now: number
): ArtifactService {
  return new ArtifactService({
    db: ctx.db,
    extension: ctx.cloudModule,
    baseUrl: ctx.config.baseUrl,
    logger: pino({ enabled: false }),
    now: () => now,
  });
}

export async function publishPostgresArtifact(
  ctx: PostgresTestContext,
  input: {
    slug: string;
    now: number;
    type?: ArtifactType;
    title?: string;
    content?: string;
    share?: boolean;
  }
): Promise<ArtifactWriteResult> {
  const service = postgresArtifactService(ctx, input.now);
  const result = await service.upsertArtifact({
    account: ctx.account,
    bot: { id: ctx.bot.id, name: ctx.bot.name, byline: ctx.bot.byline },
    slug: input.slug,
    type: input.type ?? 'markdown',
    title: input.title ?? input.slug,
    content: input.content ?? `# ${input.slug}`,
  });

  // Creation is private now; `share: true` here means "and then publish it".
  if (input.share) {
    const published = await service.createShare({
      account: ctx.account,
      idOrSlug: result.artifact.id,
    });
    return { ...result, share: published.share };
  }

  return result;
}

export async function insertPostgresShareViewer(
  ctx: Pick<PostgresTestContext, 'db'>,
  shareId: string,
  viewerId: string,
  firstViewedAt: number,
  lastViewedAt: number,
  viewCount = 1
): Promise<void> {
  await ctx.db.pool.query(
    `
      INSERT INTO share_viewers (share_id, viewer_id, first_viewed_at, last_viewed_at, view_count)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [shareId, viewerId, firstViewedAt, lastViewedAt, viewCount]
  );
}

export async function setPostgresShareAggregates(
  ctx: Pick<PostgresTestContext, 'db'>,
  shareId: string,
  input: { viewCount: number; uniqueViewerCount: number; lastViewedAt?: number | null }
): Promise<void> {
  await ctx.db.pool.query(
    `
      UPDATE shares
      SET view_count = $1, unique_viewer_count = $2, last_viewed_at = $3
      WHERE id = $4
    `,
    [input.viewCount, input.uniqueViewerCount, input.lastViewedAt ?? null, shareId]
  );
}

export async function postgresCountRows(
  ctx: Pick<PostgresTestContext, 'db'>,
  table: string,
  where = 'TRUE',
  params: unknown[] = []
): Promise<number> {
  const result = await ctx.db.pool.query<{ count: number | string }>(
    `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`,
    params
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function postgresJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

export function asPostgresDb(
  db: PostgresDatabaseHandle | SqliteDatabaseHandle
): PostgresDatabaseHandle {
  if (db.dialect !== 'postgres') {
    throw new Error('Expected PostgreSQL database handle');
  }
  return db;
}
