import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { runBackgroundSweeps } from '../../src/services/scheduler.js';
import {
  artifactService,
  countRowsWithParams,
  createIntegrationTestContext,
  DAY_MS,
  insertShareViewer,
  json,
  publishArtifact,
  TEST_NOW,
} from '../support/integration-harness.js';

const jsonContent = { 'Content-Type': 'application/json' };

describe('purge race harness', () => {
  it('QA-SHARE-024 keeps read/share races coherent while hard purge cascades rows', async () => {
    const ctx = await createIntegrationTestContext({ artifactPurgeDays: 30 });

    try {
      const created = await publishArtifact(ctx, {
        slug: 'purge-race',
        now: TEST_NOW - 45 * DAY_MS,
        content: '# purge race v1',
        share: true,
      });
      await publishArtifact(ctx, {
        slug: created.artifact.slug,
        now: TEST_NOW - 44 * DAY_MS,
        title: created.artifact.title,
        content: '# purge race v2',
        share: true,
      });
      const shareId = created.share?.shareId;
      expect(shareId).toBeDefined();
      insertShareViewer(
        ctx,
        shareId as string,
        '00000000-0000-4000-8000-000000000024',
        TEST_NOW - 43 * DAY_MS,
        TEST_NOW - 43 * DAY_MS
      );

      const softDeleted = await artifactService(ctx, TEST_NOW - 31 * DAY_MS).softDeleteArtifact({
        account: ctx.account,
        artifactId: created.artifact.id,
      });
      expect(softDeleted).toEqual({ deleted: true, revokedShareCount: 1 });

      const readDuringPurge = ctx.app.request(`/a/${shareId}/content`, {
        headers: { Cookie: 'aa_viewer=00000000-0000-4000-8000-000000000024' },
      });
      const shareDuringPurge = ctx.app.request(`/v1/artifacts/${created.artifact.slug}/share`, {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: '{}',
      });
      const purgeDuringRequests = runBackgroundSweeps({
        db: ctx.db,
        config: ctx.config,
        cloudModule: ctx.cloudModule,
        logger: pino({ enabled: false }),
        now: () => TEST_NOW,
      });

      const [readResponse, shareResponse, purgeCounts] = await Promise.all([
        readDuringPurge,
        shareDuringPurge,
        purgeDuringRequests,
      ]);

      expect([404, 410]).toContain(readResponse.status);
      if (readResponse.status === 410) {
        expect(await json(readResponse)).toMatchObject({ error: { code: 'share_revoked' } });
      } else {
        expect(await json(readResponse)).toMatchObject({ error: { code: 'not_found' } });
      }
      expect(shareResponse.status).toBe(404);
      expect(await json(shareResponse)).toMatchObject({ error: { code: 'not_found' } });
      expect(purgeCounts.softDeletedArtifactsPurged).toBe(1);
      expect(countRowsWithParams(ctx, 'artifacts', 'id = ?', [created.artifact.id])).toBe(0);
      expect(
        countRowsWithParams(ctx, 'artifact_versions', 'artifact_id = ?', [created.artifact.id])
      ).toBe(0);
      expect(countRowsWithParams(ctx, 'shares', 'id = ?', [shareId])).toBe(0);
      expect(countRowsWithParams(ctx, 'share_viewers', 'share_id = ?', [shareId])).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });
});
