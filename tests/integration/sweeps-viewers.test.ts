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

      /*
       * The ledger is RETIRED IN PLACE, not deleted, and this is what that means in practice.
       *
       * `share_viewers` and its 365-day sweep stay exactly as they were so the rows that already
       * exist age out on the schedule they were written under. Nothing writes to it any more: a
       * read now goes to `view_events` under a salted hash, and the counters on `shares` carry
       * straight on from the totals the old mechanism left behind. That continuity is the point —
       * the numbers an owner already saw must not reset.
       */
      const read = await ctx.app.request(`/a/${shareId}`, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0 Safari/537.36',
          'x-forwarded-for': '198.51.100.77',
        },
      });
      expect(read.status).toBe(200);
      await ctx.analytics.flush();

      // Counted onward from the grandfathered baseline of 4, never restarted from zero.
      expect(getShareRow(ctx, shareId as string)).toMatchObject({
        view_count: 5,
        unique_viewer_count: 4,
      });
      // And the retired ledger gained nothing: the reader was never given an identity to store.
      expect(
        countRowsWithParams(ctx, 'share_viewers', 'share_id = ? AND viewer_id = ?', [
          shareId,
          oldViewer,
        ])
      ).toBe(0);
      expect(countRowsWithParams(ctx, 'view_events', 'share_id = ?', [shareId])).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });
});
