import { describe, expect, it } from 'vitest';
import {
  AnalyticsReadModelService,
  percentChange,
} from '../../src/services/analytics-read-models.js';
import {
  createIntegrationTestContext,
  type IntegrationTestContext,
  publishArtifact,
  TEST_NOW,
} from '../support/integration-harness.js';

const HOUR = 60 * 60 * 1000;

function insertRead(
  ctx: IntegrationTestContext,
  input: { shareId: string; artifactId: string; at: number; hash: string; referrer?: string }
): void {
  const date = new Date(input.at);
  const day = date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  ctx.db.sqlite
    .prepare(
      `INSERT INTO view_events
         (share_id, artifact_id, account_id, at, day, visitor_hash, version_num, referrer_host, device, js_confirmed)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'desktop', 0)`
    )
    .run(
      input.shareId,
      input.artifactId,
      ctx.account.id,
      input.at,
      day,
      input.hash,
      input.referrer ?? null
    );
}

/**
 * The chart is only as honest as its buckets. Totals and series are separate queries, so they can
 * disagree — and a series that silently returns all zeros while the total reads 280 looks exactly
 * like a quiet week rather than like a bug, which is the failure this file exists to prevent.
 */
describe('bucketing a range', () => {
  it('places reads in the hour they happened and leaves the rest empty', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      const artifact = await publishArtifact(ctx, { slug: 'bucketed', now: TEST_NOW, share: true });
      const shareId = artifact.share?.shareId as string;
      const artifactId = artifact.artifact.id;

      // Three hours back, two reads; one hour back, one read.
      insertRead(ctx, { shareId, artifactId, at: TEST_NOW - 3 * HOUR, hash: 'a'.repeat(32) });
      insertRead(ctx, { shareId, artifactId, at: TEST_NOW - 3 * HOUR, hash: 'b'.repeat(32) });
      insertRead(ctx, { shareId, artifactId, at: TEST_NOW - 1 * HOUR, hash: 'a'.repeat(32) });

      const reads = new AnalyticsReadModelService(ctx.db, () => TEST_NOW);
      const stats = await reads.accountStats(ctx.account.id, '24h');

      expect(stats.series).toHaveLength(24);
      expect(stats.totals).toEqual({ views: 3, readers: 2 });

      // The series must add up to the total it is drawn beside.
      const charted = stats.series.reduce((sum, point) => sum + point.views, 0);
      expect(charted, 'the chart and the headline disagree').toBe(stats.totals.views);

      const busy = stats.series.filter((point) => point.views > 0);
      expect(busy).toHaveLength(2);
      expect(busy.map((point) => point.views)).toEqual([2, 1]);
      // Ascending, contiguous, and the last bucket is the most recent.
      expect(stats.series.map((point) => point.at)).toEqual(
        [...stats.series].sort((a, b) => a.at - b.at).map((point) => point.at)
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('buckets a 7-day range by day and counts readers per day', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      const artifact = await publishArtifact(ctx, { slug: 'weekly', now: TEST_NOW, share: true });
      const shareId = artifact.share?.shareId as string;
      const artifactId = artifact.artifact.id;

      for (const daysAgo of [1, 1, 3]) {
        insertRead(ctx, {
          shareId,
          artifactId,
          at: TEST_NOW - daysAgo * 24 * HOUR,
          hash: `${daysAgo}`.repeat(32),
        });
      }

      const reads = new AnalyticsReadModelService(ctx.db, () => TEST_NOW);
      const stats = await reads.accountStats(ctx.account.id, '7d');

      expect(stats.series).toHaveLength(7);
      expect(stats.series.reduce((sum, point) => sum + point.views, 0)).toBe(3);
      expect(stats.totals.views).toBe(3);
    } finally {
      await ctx.cleanup();
    }
  });

  it('ranks the most-read artifacts and reports referrers and devices', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      const loud = await publishArtifact(ctx, { slug: 'loud', now: TEST_NOW, share: true });
      const quiet = await publishArtifact(ctx, { slug: 'quiet', now: TEST_NOW, share: true });

      for (let index = 0; index < 5; index += 1) {
        insertRead(ctx, {
          shareId: loud.share?.shareId as string,
          artifactId: loud.artifact.id,
          at: TEST_NOW - HOUR,
          hash: `${index}`.repeat(32),
          referrer: 'news.ycombinator.com',
        });
      }
      insertRead(ctx, {
        shareId: quiet.share?.shareId as string,
        artifactId: quiet.artifact.id,
        at: TEST_NOW - HOUR,
        hash: 'z'.repeat(32),
      });

      const reads = new AnalyticsReadModelService(ctx.db, () => TEST_NOW);
      const account = await reads.accountStats(ctx.account.id, '24h');
      expect(account.mostVisited.map((row) => [row.slug, row.views])).toEqual([
        ['loud', 5],
        ['quiet', 1],
      ]);

      const one = await reads.artifactStats(loud.artifact.id, '24h');
      expect(one.totals).toEqual({ views: 5, readers: 5 });
      expect(one.referrers).toEqual([{ label: 'news.ycombinator.com', views: 5 }]);
      expect(one.devices).toEqual([{ label: 'desktop', views: 5 }]);
      expect(one.lastReadAt).toBe(TEST_NOW - HOUR);
    } finally {
      await ctx.cleanup();
    }
  });

  it('tells "nothing yet" apart from "nothing lately"', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      const artifact = await publishArtifact(ctx, { slug: 'aged', now: TEST_NOW, share: true });
      const reads = new AnalyticsReadModelService(ctx.db, () => TEST_NOW);

      expect((await reads.accountStats(ctx.account.id, '24h')).everRecorded).toBe(false);

      // A read older than the window: nothing lately, but definitely something once.
      insertRead(ctx, {
        shareId: artifact.share?.shareId as string,
        artifactId: artifact.artifact.id,
        at: TEST_NOW - 40 * 24 * HOUR,
        hash: 'c'.repeat(32),
      });
      const stats = await reads.accountStats(ctx.account.id, '24h');
      expect(stats.everRecorded).toBe(true);
      expect(stats.totals.views).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('the change indicator', () => {
  it('withholds a percentage when there is nothing to compare against', () => {
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(10, 5)).toBe(100);
    expect(percentChange(5, 10)).toBe(-50);
  });
});
