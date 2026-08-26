import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import pino from 'pino';
import { createApp } from '../../../src/app.js';
import { type AppConfig, loadConfig } from '../../../src/config.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../../src/db/client.js';
import { runMigrations } from '../../../src/db/migrations.js';
import type { Account, CloudModule, Plan } from '../../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../../src/extension/default-module.js';
import {
  ArtifactService,
  type ArtifactType,
  type ArtifactWriteResult,
} from '../../../src/services/artifacts.js';
import { type CreatedBot, createBot } from '../../../src/services/bots.js';
import { insertAccount } from '../../unit/db-test-utils.js';

export interface ViewerTestContext {
  cwd: string;
  config: AppConfig;
  db: SqliteDatabaseHandle;
  app: ReturnType<typeof createApp>;
  account: Account;
  cloudModule: CloudModule;
  cleanup(): Promise<void>;
}

export interface CreateViewerContextOptions {
  baseUrl?: string;
  sandboxOrigin?: string;
  rateLimitsDisabled?: boolean;
  cloudModule?: CloudModule;
}

export async function createViewerTestContext(
  options: CreateViewerContextOptions = {}
): Promise<ViewerTestContext> {
  const cwd = mkdtempSync(join(tmpdir(), 'aa-viewer-'));
  const config = loadConfig(
    {
      DEPLOYMENT: 'self-hosted',
      BASE_URL: options.baseUrl ?? 'https://agentartifact.example.test',
      AA_SQLITE_PATH: './data/app.db',
      LOG_LEVEL: 'error',
      AA_RATE_LIMITS_DISABLED: options.rateLimitsDisabled === false ? 'false' : 'true',
      ...(options.sandboxOrigin ? { SANDBOX_ORIGIN: options.sandboxOrigin } : {}),
    },
    { cwd }
  );
  const db = (await initializeDatabase(config, pino({ enabled: false }))) as SqliteDatabaseHandle;
  await runMigrations(db, pino({ enabled: false }));
  const account: Account = {
    id: `acc_${nanoid(21)}`,
    email: `viewer-${nanoid(8)}@example.test`,
    suspendedAt: null,
  };
  insertAccount(db, account);

  const cloudModule = options.cloudModule ?? createDefaultCloudModule(config);
  const app = createApp({ config, logger: pino({ enabled: false }), db, cloudModule });

  return {
    cwd,
    config,
    db,
    app,
    account,
    cloudModule,
    cleanup: async () => {
      await db.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export async function createTestBot(ctx: ViewerTestContext): Promise<CreatedBot> {
  return createBot({
    db: ctx.db,
    extension: ctx.cloudModule,
    account: ctx.account,
    name: 'R2',
    byline: "Andrej's Chief of Staff",
  });
}

export async function publishSharedArtifact(
  ctx: ViewerTestContext,
  input: {
    slug?: string;
    type?: ArtifactType;
    title?: string;
    content?: string;
    password?: string;
    bot?: CreatedBot | null;
  } = {}
): Promise<ArtifactWriteResult & { bot: CreatedBot | null }> {
  const bot = input.bot === undefined ? await createTestBot(ctx) : input.bot;
  const service = new ArtifactService({
    db: ctx.db,
    extension: ctx.cloudModule,
    baseUrl: ctx.config.baseUrl,
  });
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  const result = await service.upsertArtifact({
    account: ctx.account,
    bot: bot ? { id: bot.id, name: bot.name, byline: bot.byline } : null,
    slug: input.slug ?? 'weekly-report',
    type: input.type ?? 'markdown',
    title: input.title ?? 'Weekly Ops Report',
    content: input.content ?? '# Weekly Ops Report\n\nHello from the viewer.',
    share: true,
    ...(passwordHash !== undefined ? { passwordHash } : {}),
  });

  return { ...result, bot };
}

export async function updateArtifact(
  ctx: ViewerTestContext,
  input: {
    slug: string;
    type?: ArtifactType;
    title: string;
    content: string;
    bot?: CreatedBot | null;
  }
): Promise<ArtifactWriteResult> {
  const service = new ArtifactService({
    db: ctx.db,
    extension: ctx.cloudModule,
    baseUrl: ctx.config.baseUrl,
  });
  return service.upsertArtifact({
    account: ctx.account,
    bot: input.bot ? { id: input.bot.id, name: input.bot.name, byline: input.bot.byline } : null,
    slug: input.slug,
    type: input.type ?? 'markdown',
    title: input.title,
    content: input.content,
    share: true,
  });
}

export function shareCounters(
  ctx: ViewerTestContext,
  shareId: string
): {
  view_count: number;
  unique_viewer_count: number;
  viewers: number;
} {
  const share = ctx.db.sqlite
    .prepare('SELECT view_count, unique_viewer_count FROM shares WHERE id = ?')
    .get(shareId) as { view_count: number; unique_viewer_count: number };
  const viewers = ctx.db.sqlite
    .prepare('SELECT COUNT(*) AS count FROM share_viewers WHERE share_id = ?')
    .get(shareId) as { count: number };
  return { ...share, viewers: viewers.count };
}

export function revokeShare(ctx: ViewerTestContext, shareId: string): void {
  ctx.db.sqlite.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').run(Date.now(), shareId);
}

export function suspendAccount(ctx: ViewerTestContext): void {
  ctx.db.sqlite
    .prepare('UPDATE accounts SET suspended_at = ? WHERE id = ?')
    .run(Date.now(), ctx.account.id);
}

export function ageArtifact(ctx: ViewerTestContext, artifactId: string, updatedAt: number): void {
  ctx.db.sqlite
    .prepare('UPDATE artifacts SET updated_at = ? WHERE id = ?')
    .run(updatedAt, artifactId);
}

export function rotatePasswordTimestamp(ctx: ViewerTestContext, shareId: string): void {
  ctx.db.sqlite
    .prepare('UPDATE shares SET password_updated_at = ? WHERE id = ?')
    .run(Date.now() + 60_000, shareId);
}

export function preseedShareViewers(ctx: ViewerTestContext, shareId: string, count: number): void {
  const insert = ctx.db.sqlite.prepare(
    `
      INSERT INTO share_viewers (share_id, viewer_id, first_viewed_at, last_viewed_at, view_count)
      VALUES (?, ?, ?, ?, 1)
    `
  );
  const now = Date.now() - 60_000;
  const tx = ctx.db.sqlite.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      insert.run(shareId, `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, now, now);
    }
    ctx.db.sqlite
      .prepare('UPDATE shares SET unique_viewer_count = ?, view_count = ? WHERE id = ?')
      .run(count, count, shareId);
  });
  tx();
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

export function createTestCloudModule(plan: Plan): CloudModule {
  return {
    resolvePlan: async () => plan,
    checkQuota: async () => ({ allow: true }),
  };
}

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}
