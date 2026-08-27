import pino from 'pino';
import { describe, expect, it } from 'vitest';
import type { Clock } from '../../src/services/scheduler.js';
import { runBackgroundSweeps, startBackgroundScheduler } from '../../src/services/scheduler.js';
import {
  artifactService,
  countRowsWithParams,
  createIntegrationTestContext,
  createTestCloudModule,
  DAY_MS,
  getArtifactRow,
  getShareRow,
  insertShareViewer,
  json,
  publishArtifact,
  TEST_NOW,
  testPlan,
} from '../support/integration-harness.js';

describe('retention scheduler harness', () => {
  it('QA-VERSION-021/022 keeps soft-deleted versions until purge, then cascades purge', async () => {
    const deletedAt = TEST_NOW - 29 * DAY_MS;
    const purgeNow = TEST_NOW + 2 * DAY_MS;
    const ctx = await createIntegrationTestContext({ artifactPurgeDays: 30 });

    try {
      const first = await publishArtifact(ctx, {
        slug: 'soft-delete-history',
        now: TEST_NOW - 40 * DAY_MS,
        content: '# v1',
        share: true,
      });
      await publishArtifact(ctx, {
        slug: first.artifact.slug,
        now: TEST_NOW - 39 * DAY_MS,
        title: first.artifact.title,
        content: '# v2',
        share: true,
      });
      const shareId = first.share?.shareId;
      expect(shareId).toBeDefined();
      insertShareViewer(
        ctx,
        shareId as string,
        '00000000-0000-4000-8000-000000000021',
        TEST_NOW - 38 * DAY_MS,
        TEST_NOW - 38 * DAY_MS
      );

      const deleted = await artifactService(ctx, deletedAt).softDeleteArtifact({
        account: ctx.account,
        artifactId: first.artifact.id,
      });
      expect(deleted).toEqual({ deleted: true, revokedShareCount: 1 });

      const prePurge = await runBackgroundSweeps({
        db: ctx.db,
        config: ctx.config,
        cloudModule: ctx.cloudModule,
        logger: pino({ enabled: false }),
        now: () => TEST_NOW,
      });

      expect(prePurge.softDeletedArtifactsPurged).toBe(0);
      expect(getArtifactRow(ctx, first.artifact.id)?.deleted_at).toBe(deletedAt);
      expect(getShareRow(ctx, shareId as string)?.revoked_at).toBe(deletedAt);
      expect(
        countRowsWithParams(ctx, 'artifact_versions', 'artifact_id = ?', [first.artifact.id])
      ).toBe(2);
      expect(countRowsWithParams(ctx, 'share_viewers', 'share_id = ?', [shareId])).toBe(1);

      const ownerRead = await ctx.app.request(`/v1/artifacts/${first.artifact.id}`, {
        headers: ctx.authHeaders,
      });
      expect(ownerRead.status).toBe(404);
      const publicRead = await ctx.app.request(`/a/${shareId}/content`);
      expect(publicRead.status).toBe(410);
      expect(await json(publicRead)).toMatchObject({ error: { code: 'share_revoked' } });

      const clock: Clock = () => purgeNow;
      const scheduler = startBackgroundScheduler({
        db: ctx.db,
        config: ctx.config,
        cloudModule: ctx.cloudModule,
        logger: pino({ enabled: false }),
        now: clock,
        runImmediately: false,
        intervalMs: DAY_MS,
      });
      const purgeCounts = await scheduler.runOnce('qa-version-022');
      scheduler.stop();

      expect(purgeCounts?.softDeletedArtifactsPurged).toBe(1);
      expect(countRowsWithParams(ctx, 'artifacts', 'id = ?', [first.artifact.id])).toBe(0);
      expect(
        countRowsWithParams(ctx, 'artifact_versions', 'artifact_id = ?', [first.artifact.id])
      ).toBe(0);
      expect(countRowsWithParams(ctx, 'shares', 'id = ?', [shareId])).toBe(0);
      expect(countRowsWithParams(ctx, 'share_viewers', 'share_id = ?', [shareId])).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });

  it('QA-VERSION-021 soft-deletes plan-retained artifacts and no-ops when retention is null', async () => {
    const retentionCloud = createTestCloudModule(
      testPlan({ artifact_retention_days: 7, showFooter: true })
    );
    const retainedCtx = await createIntegrationTestContext({
      artifactPurgeDays: 30,
      cloudModule: retentionCloud,
    });

    try {
      const expired = await publishArtifact(retainedCtx, {
        slug: 'retention-expired',
        now: TEST_NOW - 8 * DAY_MS,
        share: true,
      });
      const fresh = await publishArtifact(retainedCtx, {
        slug: 'retention-fresh',
        now: TEST_NOW - 6 * DAY_MS,
        share: true,
      });

      const counts = await runBackgroundSweeps({
        db: retainedCtx.db,
        config: retainedCtx.config,
        cloudModule: retainedCtx.cloudModule,
        logger: pino({ enabled: false }),
        now: () => TEST_NOW,
      });

      expect(counts.retentionArtifactsSoftDeleted).toBe(1);
      expect(counts.retentionSharesRevoked).toBe(1);
      expect(getArtifactRow(retainedCtx, expired.artifact.id)?.deleted_at).toBe(TEST_NOW);
      expect(getShareRow(retainedCtx, expired.share?.shareId as string)?.revoked_at).toBe(TEST_NOW);
      expect(getArtifactRow(retainedCtx, fresh.artifact.id)?.deleted_at).toBeNull();
      expect(getShareRow(retainedCtx, fresh.share?.shareId as string)?.revoked_at).toBeNull();
      expect(
        countRowsWithParams(retainedCtx, 'artifact_versions', 'artifact_id = ?', [
          expired.artifact.id,
        ])
      ).toBe(1);
      const expiredPublic = await retainedCtx.app.request(
        `/a/${expired.share?.shareId as string}/content`
      );
      expect(expiredPublic.status).toBe(410);
    } finally {
      await retainedCtx.cleanup();
    }

    const permanentCtx = await createIntegrationTestContext({
      artifactPurgeDays: 30,
      cloudModule: createTestCloudModule(testPlan({ artifact_retention_days: null })),
    });

    try {
      const oldPermanent = await publishArtifact(permanentCtx, {
        slug: 'retention-null',
        now: TEST_NOW - 90 * DAY_MS,
        share: true,
      });

      const counts = await runBackgroundSweeps({
        db: permanentCtx.db,
        config: permanentCtx.config,
        cloudModule: permanentCtx.cloudModule,
        logger: pino({ enabled: false }),
        now: () => TEST_NOW,
      });

      expect(counts.retentionArtifactsSoftDeleted).toBe(0);
      expect(counts.retentionSharesRevoked).toBe(0);
      expect(getArtifactRow(permanentCtx, oldPermanent.artifact.id)?.deleted_at).toBeNull();
      expect(
        getShareRow(permanentCtx, oldPermanent.share?.shareId as string)?.revoked_at
      ).toBeNull();
      const publicRead = await permanentCtx.app.request(
        `/a/${oldPermanent.share?.shareId as string}/content`
      );
      expect(publicRead.status).toBe(200);
    } finally {
      await permanentCtx.cleanup();
    }
  });
});
