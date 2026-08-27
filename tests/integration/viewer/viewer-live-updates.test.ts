import { describe, expect, it } from 'vitest';
import { readClientSource } from '../../support/client-assets.js';
import {
  createViewerTestContext,
  publishSharedArtifact,
  shareCounters,
  updateArtifact,
} from './viewer-test-utils.js';

describe('viewer live updates, downloads, and OG', () => {
  it('serves conditional content updates, pinned downloads, OG cards, and a CSP-safe bootstrap', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'live-report',
        title: 'Live Report v1',
        content: '# Live Report\n\nVersion one',
      });
      const shareId = created.share?.shareId as string;
      await updateArtifact(ctx, {
        slug: 'live-report',
        title: 'Live Report v2',
        content: '# Live Report\n\nVersion two',
        bot: created.bot,
      });

      const page = await ctx.app.request(`/a/${shareId}`);
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toBe(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      );
      expect(html).toContain('<script id="aa-boot" type="application/json"');
      expect(html).toContain('<script type="module" src="/assets/viewer-');
      expect(html).not.toMatch(
        /<script(?![^>]*type="application\/json")(?![^>]*\ssrc=)[\s\S]*?>[\s\S]*?<\/script>/i
      );
      expect(html).toContain('Live Report v2');
      expect(html).toContain('Version two');
      expect(html).toContain('by R2 · Andrej&#39;s Chief of Staff');
      expect(html).toContain('id="aa-version-picker"');

      const latest = await ctx.app.request(`/a/${shareId}/content`);
      const latestBody = (await latest.json()) as {
        content_hash: string;
        version_num: number;
        html: string;
      };
      expect(latest.status).toBe(200);
      expect(latestBody.version_num).toBe(2);
      expect(latestBody.html).toContain('Version two');
      expect(shareCounters(ctx, shareId).view_count).toBe(1);

      const unchanged = await ctx.app.request(`/a/${shareId}/content?poll=1`, {
        headers: { 'If-None-Match': `"${latestBody.content_hash}"` },
      });
      expect(unchanged.status).toBe(304);
      expect(await unchanged.text()).toBe('');
      expect(shareCounters(ctx, shareId).view_count).toBe(1);

      const pinned = await ctx.app.request(`/a/${shareId}?v=1`);
      const pinnedHtml = await pinned.text();
      expect(pinned.status).toBe(200);
      expect(pinnedHtml).toContain('Live Report v1');
      expect(pinnedHtml).toContain('Viewing v1');

      const downloadLatest = await ctx.app.request(`/a/${shareId}/download`);
      const downloadPinned = await ctx.app.request(`/a/${shareId}/download?v=1`);
      expect(downloadLatest.status).toBe(200);
      expect(downloadLatest.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(downloadLatest.headers.get('content-disposition')).toBe(
        'attachment; filename="live-report.md"'
      );
      await expect(downloadLatest.text()).resolves.toContain('Version two');
      expect(downloadPinned.headers.get('content-disposition')).toBe(
        'attachment; filename="live-report-v1.md"'
      );
      await expect(downloadPinned.text()).resolves.toContain('Version one');

      const og = await ctx.app.request(`/a/${shareId}/og.png`);
      const ogBytes = new Uint8Array(await og.arrayBuffer());
      expect(og.status).toBe(200);
      expect(og.headers.get('content-type')).toBe('image/png');
      expect(og.headers.get('cache-control')).toBe('public, max-age=3600');
      expect(Array.from(ogBytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(shareCounters(ctx, shareId).view_count).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });

  it('ships a viewer module that polls every 30s and marks revalidation requests as poll=1', () => {
    const asset = readClientSource('viewer.js');
    expect(asset).toContain('POLL_INTERVAL_MS = 30_000');
    expect(asset).toContain("url.searchParams.set('poll', '1')");
    expect(asset).toContain("window.addEventListener('focus'");
    expect(asset).toContain("document.addEventListener('visibilitychange'");
    expect(asset).toContain('fetchContent({ poll: true, manual: true })');
    expect(asset).toContain("frame.setAttribute('sandbox', 'allow-scripts')");
    expect(asset).toContain('showUpdatedPill');
  });
});
