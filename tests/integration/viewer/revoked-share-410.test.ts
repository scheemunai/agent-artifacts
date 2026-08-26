import { describe, expect, it } from 'vitest';
import {
  ageArtifact,
  createTestCloudModule,
  createViewerTestContext,
  publishSharedArtifact,
  revokeShare,
  suspendAccount,
  testPlan,
} from './viewer-test-utils.js';

const UNKNOWN_SHARE_ID = 'AbCdEfGhIjKlMnOpQrStUv';

describe('viewer share lifecycle responses', () => {
  it('returns 410 for revoked shares and 404 for never-created share ids on every public surface', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        type: 'html',
        slug: 'revoked-html',
        title: 'Revoked HTML',
        content: '<!doctype html><h1>Revoked</h1>',
      });
      const shareId = created.share?.shareId as string;
      revokeShare(ctx, shareId);

      for (const path of [
        `/a/${shareId}`,
        `/a/${shareId}/content`,
        `/a/${shareId}/frame`,
        `/a/${shareId}/download`,
      ]) {
        const response = await ctx.app.request(path);
        expect(response.status, path).toBe(410);
      }

      for (const path of [
        `/a/${UNKNOWN_SHARE_ID}`,
        `/a/${UNKNOWN_SHARE_ID}/content`,
        `/a/${UNKNOWN_SHARE_ID}/frame`,
        `/a/${UNKNOWN_SHARE_ID}/download`,
      ]) {
        const response = await ctx.app.request(path);
        expect(response.status, path).toBe(404);
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns clean 410 pages for suspended accounts and retention-expired artifacts', async () => {
    const suspendedCtx = await createViewerTestContext();
    try {
      const created = await publishSharedArtifact(suspendedCtx, { slug: 'suspended-report' });
      const shareId = created.share?.shareId as string;
      suspendAccount(suspendedCtx);

      const response = await suspendedCtx.app.request(`/a/${shareId}`);
      const html = await response.text();
      expect(response.status).toBe(410);
      expect(html).toContain('This link has been revoked.');
      expect(html).toContain('Report abuse');
    } finally {
      await suspendedCtx.cleanup();
    }

    const expiredCtx = await createViewerTestContext({
      cloudModule: createTestCloudModule(testPlan({ artifact_retention_days: 1 })),
    });
    try {
      const created = await publishSharedArtifact(expiredCtx, { slug: 'expired-report' });
      const shareId = created.share?.shareId as string;
      ageArtifact(expiredCtx, created.artifact.id, Date.now() - 2 * 86_400_000);

      const response = await expiredCtx.app.request(`/a/${shareId}`);
      const html = await response.text();
      expect(response.status).toBe(410);
      expect(html).toContain('This artifact has expired.');
      expect(html).toContain('Report abuse');
    } finally {
      await expiredCtx.cleanup();
    }
  });
});
