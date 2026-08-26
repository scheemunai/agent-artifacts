import { describe, expect, it } from 'vitest';
import {
  createViewerTestContext,
  publishSharedArtifact,
  updateArtifact,
} from './viewer-test-utils.js';

describe('viewer slug upsert stable URL end-to-end', () => {
  it('keeps the public share URL stable while the viewer serves the updated version', async () => {
    const ctx = await createViewerTestContext();

    try {
      const first = await publishSharedArtifact(ctx, {
        slug: 'stable-url',
        title: 'Stable URL',
        content: '# Stable URL\n\nVersion 1',
      });
      const second = await updateArtifact(ctx, {
        slug: 'stable-url',
        title: 'Stable URL',
        content: '# Stable URL\n\nVersion 2',
        bot: first.bot,
      });

      expect(second.artifact.id).toBe(first.artifact.id);
      expect(second.artifact.versionNum).toBe(2);
      expect(second.share?.url).toBe(first.share?.url);

      const latest = await ctx.app.request(`/a/${first.share?.shareId}/content`);
      const latestBody = (await latest.json()) as { version_num: number; html: string };
      expect(latest.status).toBe(200);
      expect(latestBody.version_num).toBe(2);
      expect(latestBody.html).toContain('Version 2');

      const pinned = await ctx.app.request(`/a/${first.share?.shareId}/content?v=1`);
      const pinnedBody = (await pinned.json()) as { version_num: number; html: string };
      expect(pinned.status).toBe(200);
      expect(pinnedBody.version_num).toBe(1);
      expect(pinnedBody.html).toContain('Version 1');
    } finally {
      await ctx.cleanup();
    }
  });
});
