import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { dayOf } from '../../src/services/analytics.js';
import { runBackgroundSweeps } from '../../src/services/scheduler.js';
import {
  countRows,
  createIntegrationTestContext,
  DAY_MS,
  publishArtifact,
  TEST_NOW,
} from '../support/integration-harness.js';

/**
 * Retention is the other half of the privacy claim.
 *
 * A salted hash is only unlinkable because the salt stops existing, and the reads are only
 * "ninety days of history" because the older ones are actually deleted. Both are one more job on
 * the sweep that was already running nightly.
 */
describe('analytics retention', () => {
  it('drops reads past 90 days and salts past 2, and keeps everything younger', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      const artifact = await publishArtifact(ctx, {
        slug: 'retained-reads',
        now: TEST_NOW,
        share: true,
      });
      const shareId = artifact.share?.shareId as string;
      const dayAt = (offsetDays: number): number => dayOf(TEST_NOW - offsetDays * DAY_MS);

      const insertRead = (offsetDays: number, hash: string): void => {
        ctx.db.sqlite
          .prepare(
            `INSERT INTO view_events
               (share_id, artifact_id, account_id, at, day, visitor_hash, version_num, referrer_host, device, js_confirmed)
             VALUES (?, ?, ?, ?, ?, ?, 1, NULL, 'desktop', 0)`
          )
          .run(
            shareId,
            artifact.artifact.id,
            ctx.account.id,
            TEST_NOW - offsetDays * DAY_MS,
            dayAt(offsetDays),
            hash
          );
        ctx.db.sqlite
          .prepare(
            'INSERT OR IGNORE INTO share_visitor_days (share_id, day, visitor_hash) VALUES (?, ?, ?)'
          )
          .run(shareId, dayAt(offsetDays), hash);
      };

      insertRead(91, 'a'.repeat(32));
      insertRead(89, 'b'.repeat(32));
      for (const offset of [3, 1]) {
        ctx.db.sqlite
          .prepare('INSERT OR IGNORE INTO analytics_salts (day, salt, created_at) VALUES (?, ?, ?)')
          .run(dayAt(offset), `salt-${offset}`, TEST_NOW);
      }

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: ctx.config,
        cloudModule: ctx.cloudModule,
        logger: pino({ enabled: false }),
        now: () => TEST_NOW,
      });

      expect(counts.viewEventsPurged).toBe(1);
      expect(counts.analyticsSaltsPurged).toBe(1);
      expect(countRows(ctx, 'view_events')).toBe(1);
      // The ledger goes with the reads it describes: a visitor-day row outliving its events would
      // be a hash with nothing left to explain, kept past the salt that made it.
      expect(countRows(ctx, 'share_visitor_days')).toBe(1);
      expect(countRows(ctx, 'analytics_salts')).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });
});
