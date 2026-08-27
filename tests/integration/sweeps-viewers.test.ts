import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { runBackgroundSweeps } from '../../src/services/scheduler.js';
import {
  countRowsWithParams,
  createIntegrationTestContext,
  DAY_MS,
  getShareRow,
  insertShareViewer,
  publishArtifact,
  setShareAggregates,
  TEST_NOW,
} from '../support/integration-harness.js';

describe('share viewer sweep harness', () => {
  it('QA-VIEWS-022 prunes only >365d viewer rows and preserves aggregate counters', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      const artifact = await publishArtifact(ctx, {
        slug: 'viewer-ledger-prune',
        now: TEST_NOW,
        share: true,
      });
      const shareId = artifact.share?.shareId;
      expect(shareId).toBeDefined();

      const oldViewer = '00000000-0000-4000-8000-000000000365';
      const boundaryViewer = '00000000-0000-4000-8000-000000000366';
      const recentViewer = '00000000-0000-4000-8000-000000000367';
      insertShareViewer(
        ctx,
        shareId as string,
        oldViewer,
        TEST_NOW - 366 * DAY_MS,
        TEST_NOW - 366 * DAY_MS,
        2
      );
      insertShareViewer(
        ctx,
        shareId as string,
        boundaryViewer,
        TEST_NOW - 365 * DAY_MS,
        TEST_NOW - 365 * DAY_MS
      );
      insertShareViewer(
        ctx,
        shareId as string,
        recentViewer,
        TEST_NOW - 364 * DAY_MS,
        TEST_NOW - 364 * DAY_MS
      );
      setShareAggregates(ctx, shareId as string, {
        viewCount: 4,
        uniqueViewerCount: 3,
        lastViewedAt: TEST_NOW - 364 * DAY_MS,
      });

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: ctx.config,
        cloudModule: ctx.cloudModule,
        logger: pino({ enabled: false }),
        now: () => TEST_NOW,
      });

      expect(counts.shareViewersPruned).toBe(1);
      expect(
        countRowsWithParams(ctx, 'share_viewers', 'share_id = ? AND viewer_id = ?', [
          shareId,
          oldViewer,
        ])
      ).toBe(0);
      expect(
        countRowsWithParams(ctx, 'share_viewers', 'share_id = ? AND viewer_id = ?', [
          shareId,
          boundaryViewer,
        ])
      ).toBe(1);
      expect(
        countRowsWithParams(ctx, 'share_viewers', 'share_id = ? AND viewer_id = ?', [
          shareId,
          recentViewer,
        ])
      ).toBe(1);
      expect(getShareRow(ctx, shareId as string)).toMatchObject({
        view_count: 4,
        unique_viewer_count: 3,
        last_viewed_at: TEST_NOW - 364 * DAY_MS,
      });

      const returningViewer = await ctx.app.request(`/a/${shareId}/content`, {
        headers: { Cookie: `aa_viewer=${oldViewer}` },
      });
      expect(returningViewer.status).toBe(200);
      expect(getShareRow(ctx, shareId as string)).toMatchObject({
        view_count: 5,
        unique_viewer_count: 4,
      });
      expect(
        countRowsWithParams(ctx, 'share_viewers', 'share_id = ? AND viewer_id = ?', [
          shareId,
          oldViewer,
        ])
      ).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });
});
