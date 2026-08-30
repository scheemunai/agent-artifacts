import { describe, expect, it } from 'vitest';
import {
  createViewerTestContext,
  preseedShareViewers,
  publishSharedArtifact,
  shareCounters,
} from './viewer-test-utils.js';

describe('viewer poll requests do not count views', () => {
  it('counts only the initial non-poll content fetch and throttles repeats per viewer', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'views-report',
        title: 'Views Report',
        content: '# Views Report\n\nInitial content',
      });
      const shareId = created.share?.shareId as string;

      const shell = await ctx.app.request(`/a/${shareId}`);
      expect(shell.status).toBe(200);
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 0,
        unique_viewer_count: 0,
        viewers: 0,
      });

      const initial = await ctx.app.request(`/a/${shareId}/content`);
      const initialCookie = initial.headers.get('set-cookie') ?? '';
      const initialBody = (await initial.json()) as { content_hash: string; html: string };
      expect(initial.status).toBe(200);
      expect(initialCookie).toContain('aa_viewer=');
      expect(initialCookie).toContain('Max-Age=31536000');
      expect(initialCookie).toContain('HttpOnly');
      expect(initialCookie).toContain('SameSite=Lax');
      expect(initialCookie).toContain('Secure');
      expect(initialBody.html).toContain('Initial content');
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 1,
        unique_viewer_count: 1,
        viewers: 1,
      });

      const cookie = cookiePair(initialCookie, 'aa_viewer');
      const immediateRepeat = await ctx.app.request(`/a/${shareId}/content`, {
        headers: { Cookie: cookie },
      });
      expect(immediateRepeat.status).toBe(200);
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 1,
        unique_viewer_count: 1,
        viewers: 1,
      });

      for (let index = 0; index < 10; index += 1) {
        const poll = await ctx.app.request(`/a/${shareId}/content?poll=1`, {
          headers: { Cookie: cookie, 'If-None-Match': `"${initialBody.content_hash}"` },
        });
        expect(poll.status).toBe(304);
      }
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 1,
        unique_viewer_count: 1,
        viewers: 1,
      });

      const manualRefresh = await ctx.app.request(`/a/${shareId}/content?poll=1`, {
        headers: { Cookie: cookie },
      });
      expect(manualRefresh.status).toBe(200);
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 1,
        unique_viewer_count: 1,
        viewers: 1,
      });

      // `?v=1` from a visitor who is not the signed-in owner is ignored: they get the latest, and
      // the response is cached as the latest — `immutable` here would park the current artifact in
      // their browser under a historical URL.
      const pinned = await ctx.app.request(`/a/${shareId}/content?v=1`, {
        headers: { Cookie: cookie },
      });
      expect(pinned.status).toBe(200);
      expect(pinned.headers.get('cache-control')).toBe('private, max-age=10, must-revalidate');
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 1,
        unique_viewer_count: 1,
        viewers: 1,
      });

      const download = await ctx.app.request(`/a/${shareId}/download`, {
        headers: { Cookie: cookie },
      });
      const og = await ctx.app.request(`/a/${shareId}/og.png`, { headers: { Cookie: cookie } });
      const frame = await ctx.app.request(`/a/${shareId}/frame`, { headers: { Cookie: cookie } });
      expect(download.status).toBe(200);
      expect(og.status).toBe(200);
      expect(frame.status).toBe(404);
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 1,
        unique_viewer_count: 1,
        viewers: 1,
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('serves HEAD probes without counting a view or minting a viewer cookie', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'head-probe-report',
        title: 'Head Probe Report',
      });
      const shareId = created.share?.shareId as string;

      for (let index = 0; index < 3; index += 1) {
        const probe = await ctx.app.request(`/a/${shareId}/content`, { method: 'HEAD' });
        expect(probe.status).toBe(200);
        expect(probe.headers.get('etag')).toBe(`"${created.artifact.contentHash}"`);
        expect(probe.headers.get('cache-control')).toBe('private, max-age=10, must-revalidate');
        expect(probe.headers.get('set-cookie')).toBeNull();
      }

      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 0,
        unique_viewer_count: 0,
        viewers: 0,
      });

      const read = await ctx.app.request(`/a/${shareId}/content`);
      expect(read.status).toBe(200);
      expect(read.headers.get('set-cookie')).toContain('aa_viewer=');
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 1,
        unique_viewer_count: 1,
        viewers: 1,
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('caps unique viewer rows at 50000 while continuing to count non-poll views', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, { slug: 'cap-report' });
      const shareId = created.share?.shareId as string;
      preseedShareViewers(ctx, shareId, 50_000);

      const response = await ctx.app.request(`/a/${shareId}/content`, {
        headers: { Cookie: 'aa_viewer=00000000-0000-4000-8000-999999999999' },
      });
      expect(response.status).toBe(200);
      expect(shareCounters(ctx, shareId)).toEqual({
        view_count: 50_001,
        unique_viewer_count: 50_000,
        viewers: 50_000,
      });
    } finally {
      await ctx.cleanup();
    }
  });
});

function cookiePair(setCookie: string, name: string): string {
  const pair = setCookie.split(';')[0];
  if (!pair?.startsWith(`${name}=`)) {
    throw new Error(`Missing ${name} cookie`);
  }
  return pair;
}
