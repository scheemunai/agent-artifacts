import { describe, expect, it } from 'vitest';
import {
  createViewerTestContext,
  publishSharedArtifact,
  READER_UA,
  readPage,
  shareCounters,
} from './viewer-test-utils.js';

/**
 * WHAT DOES NOT COUNT.
 *
 * The counterpart to `view-capture.test.ts`, which owns what does. The split is deliberate: a read
 * is recorded in exactly one place now, so every other surface this product serves is a chance to
 * record it twice, and each one is named here rather than left to be inferred from the absence of a
 * test. The list is the same as it was before counting moved — polls, refreshes, conditional
 * requests, downloads, OG cards, frames, HEAD — which is the property that had to survive the move.
 */
describe('the surfaces that must never count a view', () => {
  it('counts the page once and stays there through polls, refreshes, downloads and OG', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'views-report',
        title: 'Views Report',
        content: '# Views Report\n\nInitial content',
      });
      const shareId = created.share?.shareId as string;

      const page = await readPage(ctx, shareId);
      expect(page.status).toBe(200);
      // The artifact is IN this response — which is why a reader who runs no JavaScript has still
      // read it, and why this is the honest place to count.
      await expect(page.text()).resolves.toContain('Initial content');
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 1, unique_viewer_count: 1 });

      const initial = await ctx.app.request(`/a/${shareId}/content`, {
        headers: { 'user-agent': READER_UA },
      });
      const body = (await initial.json()) as { content_hash: string; html: string };
      expect(initial.status).toBe(200);
      expect(body.html).toContain('Initial content');
      await ctx.analytics.flush();
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 1, unique_viewer_count: 1 });

      // Ten polls, a conditional hit, and a manual refresh.
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const polled = await ctx.app.request(`/a/${shareId}/content?poll=1`, {
          headers: { 'If-None-Match': `"${body.content_hash}"`, 'user-agent': READER_UA },
        });
        expect(polled.status).toBe(304);
      }
      const manual = await ctx.app.request(`/a/${shareId}/content?poll=1`, {
        headers: { 'user-agent': READER_UA },
      });
      expect(manual.status).toBe(200);

      for (const path of ['/download', '/og.png']) {
        const response = await ctx.app.request(`/a/${shareId}${path}`, {
          headers: { 'user-agent': READER_UA },
        });
        expect(response.status, path).toBe(200);
      }
      // A markdown artifact has no sandbox frame to serve, so this is a 404 — requested anyway,
      // because "the route answered" is not the property under test. "It did not count" is.
      await ctx.app.request(`/a/${shareId}/frame`, { headers: { 'user-agent': READER_UA } });

      await ctx.analytics.flush();
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 1, unique_viewer_count: 1 });
    } finally {
      await ctx.cleanup();
    }
  });

  it('serves HEAD probes without counting anything', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'head-probe',
        title: 'Head Probe',
        content: '# Head Probe',
      });
      const shareId = created.share?.shareId as string;

      for (let probe = 0; probe < 3; probe += 1) {
        const response = await ctx.app.request(`/a/${shareId}`, {
          method: 'HEAD',
          headers: { 'user-agent': READER_UA },
        });
        expect(response.status).toBe(200);
        // The mechanism that made this necessary is gone, and it must stay gone: nothing on the
        // read path may hand a browser an identifier again.
        expect(response.headers.get('set-cookie')).toBeNull();
      }

      await ctx.analytics.flush();
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 0, unique_viewer_count: 0 });
    } finally {
      await ctx.cleanup();
    }
  });

  it('treats a browser prefetch as nobody having looked at anything', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'prefetched',
        title: 'Prefetched',
        content: '# Prefetched',
      });
      const shareId = created.share?.shareId as string;

      for (const header of [
        { 'sec-purpose': 'prefetch;prerender' },
        { purpose: 'prefetch' },
        { 'x-moz': 'prefetch' },
      ]) {
        const response = await ctx.app.request(`/a/${shareId}`, {
          headers: { 'user-agent': READER_UA, ...header },
        });
        expect(response.status).toBe(200);
      }

      await ctx.analytics.flush();
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 0 });
    } finally {
      await ctx.cleanup();
    }
  });
});
