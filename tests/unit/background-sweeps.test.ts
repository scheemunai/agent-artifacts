import { nanoid } from 'nanoid';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { CloudModule, Plan } from '../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { runBackgroundSweeps } from '../../src/services/scheduler.js';
import { createMigratedSqliteContext, type TestDatabaseContext } from './db-test-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const baseNow = 1_800_000_000_000;
const logger = pino({ enabled: false });
const sweepConfig = { artifactPurgeDays: 30, baseUrl: 'http://localhost:3000' };

describe('background sweeps', () => {
  it('purges soft-deleted artifacts after the configured purge window', async () => {
    const ctx = await createMigratedSqliteContext();
    const cloudModule = createDefaultCloudModule({ aaHideFooter: false });

    try {
      const oldDeleted = await createArtifact(ctx, cloudModule, {
        slug: 'old-deleted',
        now: baseNow - 31 * DAY_MS,
      });
      await service(ctx, cloudModule, baseNow - 31 * DAY_MS).softDeleteArtifact({
        account: ctx.account,
        artifactId: oldDeleted.artifact.id,
      });
      const recentDeleted = await createArtifact(ctx, cloudModule, {
        slug: 'recent-deleted',
        now: baseNow - DAY_MS,
      });
      await service(ctx, cloudModule, baseNow - DAY_MS).softDeleteArtifact({
        account: ctx.account,
        artifactId: recentDeleted.artifact.id,
      });

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: sweepConfig,
        cloudModule,
        logger,
        now: () => baseNow,
      });

      expect(counts.softDeletedArtifactsPurged).toBe(1);
      expect(artifactExists(ctx, oldDeleted.artifact.id)).toBe(false);
      expect(artifactExists(ctx, recentDeleted.artifact.id)).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it('deletes expired sessions and keeps live sessions', async () => {
    const ctx = await createMigratedSqliteContext();

    try {
      insertSession(ctx, 'sess_expired', baseNow - 1);
      insertSession(ctx, 'sess_live', baseNow + DAY_MS);

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: sweepConfig,
        cloudModule: createDefaultCloudModule({ aaHideFooter: false }),
        logger,
        now: () => baseNow,
      });

      expect(counts.expiredSessionsDeleted).toBe(1);
      expect(sessionExists(ctx, 'sess_expired')).toBe(false);
      expect(sessionExists(ctx, 'sess_live')).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it('deletes expired or consumed magic-link tokens and keeps reusable live tokens', async () => {
    const ctx = await createMigratedSqliteContext();

    try {
      insertMagicLink(ctx, 'expired', baseNow - 1, null);
      insertMagicLink(ctx, 'consumed', baseNow + DAY_MS, baseNow - 10);
      insertMagicLink(ctx, 'live', baseNow + DAY_MS, null);

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: sweepConfig,
        cloudModule: createDefaultCloudModule({ aaHideFooter: false }),
        logger,
        now: () => baseNow,
      });

      expect(counts.magicLinkTokensDeleted).toBe(2);
      expect(magicLinkExists(ctx, 'expired')).toBe(false);
      expect(magicLinkExists(ctx, 'consumed')).toBe(false);
      expect(magicLinkExists(ctx, 'live')).toBe(true);
    } finally {
      await ctx.cleanup();
    }
  });

  it('prunes share_viewers rows older than 365 days while preserving aggregate counters', async () => {
    const ctx = await createMigratedSqliteContext();
    const cloudModule = createDefaultCloudModule({ aaHideFooter: false });

    try {
      const created = await createArtifact(ctx, cloudModule, {
        slug: 'viewer-retention',
        share: true,
        now: baseNow,
      });
      const shareId = created.share?.shareId ?? '';
      insertShareViewer(ctx, shareId, 'viewer-old', baseNow - 366 * DAY_MS);
      insertShareViewer(ctx, shareId, 'viewer-live', baseNow - 364 * DAY_MS);
      ctx.db.sqlite
        .prepare('UPDATE shares SET view_count = 2, unique_viewer_count = 2 WHERE id = ?')
        .run(shareId);

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: sweepConfig,
        cloudModule,
        logger,
        now: () => baseNow,
      });

      expect(counts.shareViewersPruned).toBe(1);
      expect(shareViewerExists(ctx, shareId, 'viewer-old')).toBe(false);
      expect(shareViewerExists(ctx, shareId, 'viewer-live')).toBe(true);
      expect(shareAggregate(ctx, shareId)).toEqual({ view_count: 2, unique_viewer_count: 2 });
    } finally {
      await ctx.cleanup();
    }
  });

  it('leaves active artifacts untouched when plan artifact_retention_days is null', async () => {
    const ctx = await createMigratedSqliteContext();
    const cloudModule = cloudModuleWithRetention(null);

    try {
      const created = await createArtifact(ctx, cloudModule, {
        slug: 'retention-null',
        share: true,
        now: baseNow - 90 * DAY_MS,
      });

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: sweepConfig,
        cloudModule,
        logger,
        now: () => baseNow,
      });

      expect(counts.retentionArtifactsSoftDeleted).toBe(0);
      expect(artifactDeletedAt(ctx, created.artifact.id)).toBeNull();
      expect(activeShareRevokedAt(ctx, created.artifact.id)).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });

  it('soft-deletes artifacts beyond plan retention and revokes active shares idempotently', async () => {
    const ctx = await createMigratedSqliteContext();
    const cloudModule = cloudModuleWithRetention(1);

    try {
      const created = await createArtifact(ctx, cloudModule, {
        slug: 'retention-expired',
        share: true,
        now: baseNow - 2 * DAY_MS,
      });

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: sweepConfig,
        cloudModule,
        logger,
        now: () => baseNow,
      });
      const repeatCounts = await runBackgroundSweeps({
        db: ctx.db,
        config: sweepConfig,
        cloudModule,
        logger,
        now: () => baseNow,
      });

      expect(counts.retentionArtifactsSoftDeleted).toBe(1);
      expect(counts.retentionSharesRevoked).toBe(1);
      expect(artifactDeletedAt(ctx, created.artifact.id)).toBe(baseNow);
      expect(activeShareRevokedAt(ctx, created.artifact.id)).toBe(baseNow);
      expect(repeatCounts.retentionArtifactsSoftDeleted).toBe(0);
      expect(repeatCounts.retentionSharesRevoked).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });
});

function service(ctx: TestDatabaseContext, cloudModule: CloudModule, now: number): ArtifactService {
  return new ArtifactService({
    db: ctx.db,
    extension: cloudModule,
    baseUrl: sweepConfig.baseUrl,
    now: () => now,
    logger,
  });
}

async function createArtifact(
  ctx: TestDatabaseContext,
  cloudModule: CloudModule,
  input: { slug: string; now: number; share?: boolean }
) {
  return service(ctx, cloudModule, input.now).upsertArtifact({
    account: ctx.account,
    bot: null,
    slug: input.slug,
    type: 'markdown',
    title: input.slug,
    content: `# ${input.slug}`,
    share: input.share ?? false,
  });
}

function cloudModuleWithRetention(retentionDays: number | null): CloudModule {
  const plan: Plan = {
    id: 'test',
    name: 'Test',
    showFooter: true,
    limits: { maxBots: null, maxArtifacts: null },
    artifact_retention_days: retentionDays,
  };
  return {
    resolvePlan: async () => plan,
    checkQuota: async () => ({ allow: true }),
  };
}

function insertSession(ctx: TestDatabaseContext, id: string, expiresAt: number): void {
  ctx.db.sqlite
    .prepare(
      'INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, NULL)'
    )
    .run(id, ctx.account.id, baseNow - DAY_MS, expiresAt);
}

function insertMagicLink(
  ctx: TestDatabaseContext,
  suffix: string,
  expiresAt: number,
  consumedAt: number | null
): void {
  ctx.db.sqlite
    .prepare(
      `
        INSERT INTO magic_link_tokens (
          id, token_hash, email, account_id, created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      `mlt_${suffix}_${nanoid(8)}`,
      `hash_${suffix}_${nanoid(8)}`,
      `${suffix}@example.test`,
      ctx.account.id,
      baseNow - DAY_MS,
      expiresAt,
      consumedAt
    );
}

function insertShareViewer(
  ctx: TestDatabaseContext,
  shareId: string,
  viewerId: string,
  lastViewedAt: number
): void {
  ctx.db.sqlite
    .prepare(
      `
        INSERT INTO share_viewers (share_id, viewer_id, first_viewed_at, last_viewed_at, view_count)
        VALUES (?, ?, ?, ?, 1)
      `
    )
    .run(shareId, viewerId, lastViewedAt, lastViewedAt);
}

function artifactExists(ctx: TestDatabaseContext, artifactId: string): boolean {
  return Boolean(
    ctx.db.sqlite.prepare('SELECT 1 FROM artifacts WHERE id = ?').get(artifactId) as unknown
  );
}

function sessionExists(ctx: TestDatabaseContext, id: string): boolean {
  return Boolean(ctx.db.sqlite.prepare('SELECT 1 FROM sessions WHERE id = ?').get(id) as unknown);
}

function magicLinkExists(ctx: TestDatabaseContext, tokenPart: string): boolean {
  return Boolean(
    ctx.db.sqlite
      .prepare('SELECT 1 FROM magic_link_tokens WHERE token_hash LIKE ?')
      .get(`hash_${tokenPart}_%`) as unknown
  );
}

function shareViewerExists(ctx: TestDatabaseContext, shareId: string, viewerId: string): boolean {
  return Boolean(
    ctx.db.sqlite
      .prepare('SELECT 1 FROM share_viewers WHERE share_id = ? AND viewer_id = ?')
      .get(shareId, viewerId) as unknown
  );
}

function shareAggregate(
  ctx: TestDatabaseContext,
  shareId: string
): { view_count: number; unique_viewer_count: number } {
  return ctx.db.sqlite
    .prepare('SELECT view_count, unique_viewer_count FROM shares WHERE id = ?')
    .get(shareId) as { view_count: number; unique_viewer_count: number };
}

function artifactDeletedAt(ctx: TestDatabaseContext, artifactId: string): number | null {
  const row = ctx.db.sqlite
    .prepare('SELECT deleted_at FROM artifacts WHERE id = ?')
    .get(artifactId) as { deleted_at: number | null } | undefined;
  return row?.deleted_at ?? null;
}

function activeShareRevokedAt(ctx: TestDatabaseContext, artifactId: string): number | null {
  const row = ctx.db.sqlite
    .prepare('SELECT revoked_at FROM shares WHERE artifact_id = ?')
    .get(artifactId) as { revoked_at: number | null } | undefined;
  return row?.revoked_at ?? null;
}
