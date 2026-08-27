import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { nanoid } from 'nanoid';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { type AppConfig, loadConfig } from '../../src/config.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
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
import { type CreatedBot, createBot } from '../../src/services/bots.js';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const TEST_NOW = 1_800_000_000_000;

export interface IntegrationTestContext {
  cwd: string;
  config: AppConfig;
  db: SqliteDatabaseHandle;
  app: ReturnType<typeof createApp>;
  account: Account;
  bot: CreatedBot;
  cloudModule: CloudModule;
  authHeaders: Record<string, string>;
  cleanup(): Promise<void>;
}

export interface CreateIntegrationTestContextOptions {
  cloudModule?: CloudModule;
  logger?: Logger;
  rateLimitsDisabled?: boolean;
  artifactPurgeDays?: number;
  baseUrl?: string;
}

export async function createIntegrationTestContext(
  options: CreateIntegrationTestContextOptions = {}
): Promise<IntegrationTestContext> {
  globalRateLimitStore.reset();

  const cwd = mkdtempSync(join(tmpdir(), 'aa-integration-'));
  const config = loadConfig(
    {
      DEPLOYMENT: 'self-hosted',
      BASE_URL: options.baseUrl ?? 'https://agentartifact.example.test',
      AA_SQLITE_PATH: './data/app.db',
      AA_RATE_LIMITS_DISABLED: String(options.rateLimitsDisabled ?? true),
      ...(options.artifactPurgeDays !== undefined
        ? { AA_ARTIFACT_PURGE_DAYS: String(options.artifactPurgeDays) }
        : {}),
      LOG_LEVEL: 'error',
    },
    { cwd }
  );
  const logger = options.logger ?? pino({ enabled: false });
  const db = (await initializeDatabase(config, logger)) as SqliteDatabaseHandle;
  await runMigrations(db, logger);

  const cloudModule = options.cloudModule ?? createDefaultCloudModule(config);
  const account: Account = {
    id: `acc_${nanoid(21)}`,
    email: `tester-${nanoid(8)}@example.test`,
    suspendedAt: null,
  };
  insertAccount(db, account, TEST_NOW);

  const bot = await createBot({
    db,
    extension: cloudModule,
    account,
    name: 'Regression Bot',
    byline: 'Harness test bot',
  });
  const app = createApp({ config, logger, db, cloudModule });

  return {
    cwd,
    config,
    db,
    app,
    account,
    bot,
    cloudModule,
    authHeaders: { Authorization: `Bearer ${bot.apiKey}` },
    cleanup: async () => {
      await db.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export function createTestCloudModule(plan: Plan): CloudModule {
  return {
    resolvePlan: async () => plan,
    checkQuota: async () => ({ allow: true }),
  };
}

export function testPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'test',
    name: 'Test',
    showFooter: true,
    limits: { maxBots: null, maxArtifacts: null },
    artifact_retention_days: null,
    ...overrides,
  };
}

export async function publishArtifact(
  ctx: IntegrationTestContext,
  input: {
    slug: string;
    now: number;
    type?: ArtifactType;
    title?: string;
    content?: string;
    share?: boolean;
  }
): Promise<ArtifactWriteResult> {
  return artifactService(ctx, input.now).upsertArtifact({
    account: ctx.account,
    bot: { id: ctx.bot.id, name: ctx.bot.name, byline: ctx.bot.byline },
    slug: input.slug,
    type: input.type ?? 'markdown',
    title: input.title ?? input.slug,
    content: input.content ?? `# ${input.slug}`,
    share: input.share ?? false,
  });
}

export function artifactService(ctx: IntegrationTestContext, now: number): ArtifactService {
  return new ArtifactService({
    db: ctx.db,
    extension: ctx.cloudModule,
    baseUrl: ctx.config.baseUrl,
    logger: pino({ enabled: false }),
    now: () => now,
  });
}

export function insertAccount(db: SqliteDatabaseHandle, account: Account, now: number): void {
  db.sqlite
    .prepare(
      `
        INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `
    )
    .run(account.id, account.email, account.suspendedAt, now, now);
}

export function insertShareViewer(
  ctx: IntegrationTestContext,
  shareId: string,
  viewerId: string,
  firstViewedAt: number,
  lastViewedAt: number,
  viewCount = 1
): void {
  ctx.db.sqlite
    .prepare(
      `
        INSERT INTO share_viewers (share_id, viewer_id, first_viewed_at, last_viewed_at, view_count)
        VALUES (?, ?, ?, ?, ?)
      `
    )
    .run(shareId, viewerId, firstViewedAt, lastViewedAt, viewCount);
}

export function setShareAggregates(
  ctx: IntegrationTestContext,
  shareId: string,
  input: { viewCount: number; uniqueViewerCount: number; lastViewedAt?: number | null }
): void {
  ctx.db.sqlite
    .prepare(
      `
        UPDATE shares
        SET view_count = ?, unique_viewer_count = ?, last_viewed_at = ?
        WHERE id = ?
      `
    )
    .run(input.viewCount, input.uniqueViewerCount, input.lastViewedAt ?? null, shareId);
}

export function countRows(ctx: IntegrationTestContext, table: string, where = '1=1'): number {
  const row = ctx.db.sqlite
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
    .get() as {
    count: number;
  };
  return row.count;
}

export function countRowsWithParams(
  ctx: IntegrationTestContext,
  table: string,
  where: string,
  params: unknown[]
): number {
  const row = ctx.db.sqlite
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`)
    .get(...params) as {
    count: number;
  };
  return row.count;
}

export function getArtifactRow(
  ctx: IntegrationTestContext,
  artifactId: string
): { id: string; deleted_at: number | null; updated_at: number; version_num: number } | undefined {
  return ctx.db.sqlite
    .prepare('SELECT id, deleted_at, updated_at, version_num FROM artifacts WHERE id = ?')
    .get(artifactId) as
    | { id: string; deleted_at: number | null; updated_at: number; version_num: number }
    | undefined;
}

export function getShareRow(
  ctx: IntegrationTestContext,
  shareId: string
):
  | {
      id: string;
      artifact_id: string;
      revoked_at: number | null;
      view_count: number;
      unique_viewer_count: number;
      last_viewed_at: number | null;
    }
  | undefined {
  return ctx.db.sqlite
    .prepare(
      `
        SELECT id, artifact_id, revoked_at, view_count, unique_viewer_count, last_viewed_at
        FROM shares
        WHERE id = ?
      `
    )
    .get(shareId) as
    | {
        id: string;
        artifact_id: string;
        revoked_at: number | null;
        view_count: number;
        unique_viewer_count: number;
        last_viewed_at: number | null;
      }
    | undefined;
}

export async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

export interface LogCapture {
  logger: Logger;
  entries(): Array<Record<string, unknown>>;
}

export function createLogCapture(): LogCapture {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });

  const logger = pino({ level: 'debug' }, stream);
  return {
    logger,
    entries: () =>
      lines
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
