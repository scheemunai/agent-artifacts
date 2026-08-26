import { describe, expect, it } from 'vitest';
import { createViewerTestContext, publishSharedArtifact } from './viewer-test-utils.js';

describe('viewer HTML sandbox isolation', () => {
  it('renders raw HTML only through a sandboxed frame with the exact frame CSP and no cookies', async () => {
    const sandboxOrigin = 'https://usercontent.example.test';
    const ctx = await createViewerTestContext({ sandboxOrigin });

    try {
      const hostileHtml = `<!doctype html>
<html><body>
<script>
  window.__cookie = document.cookie;
  window.__parent = window.parent.document.body.innerText;
  fetch('/v1/artifacts');
</script>
<h1>Hostile artifact</h1>
</body></html>`;
      const created = await publishSharedArtifact(ctx, {
        type: 'html',
        slug: 'hostile-html',
        title: 'Hostile HTML',
        content: hostileHtml,
      });
      const shareId = created.share?.shareId as string;

      const page = await ctx.app.request(`https://agentartifact.example.test/a/${shareId}`);
      const pageHtml = await page.text();
      expect(page.status).toBe(200);
      expect(page.headers.get('content-security-policy')).toBe(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-src https://usercontent.example.test; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      );
      expect(page.headers.get('permissions-policy')).toBe(
        'camera=(), microphone=(), geolocation=(), payment=()'
      );
      expect(pageHtml).toContain('sandbox="allow-scripts"');
      expect(pageHtml).not.toContain('allow-same-origin');
      expect(pageHtml).toContain(`src="${sandboxOrigin}/a/${shareId}/frame?h=`);
      expect(pageHtml).not.toContain('window.__cookie');
      expect(pageHtml).not.toContain('window.parent.document');
      expect(pageHtml).not.toContain('<h1>Hostile artifact</h1>');

      const appHostFrame = await ctx.app.request(
        `https://agentartifact.example.test/a/${shareId}/frame`
      );
      expect(appHostFrame.status).toBe(301);
      expect(appHostFrame.headers.get('location')).toBe(`${sandboxOrigin}/a/${shareId}/frame`);

      const frame = await ctx.app.request(`${sandboxOrigin}/a/${shareId}/frame`, {
        headers: { Cookie: 'aa_session=fake; aa_viewer=fake' },
      });
      const frameText = await frame.text();
      expect(frame.status).toBe(200);
      expect(frame.headers.get('content-type')).toMatch(/^text\/html/i);
      expect(frame.headers.get('content-security-policy')).toBe(
        "sandbox allow-scripts; default-src 'none'; script-src https: 'unsafe-inline' 'unsafe-eval'; style-src https: 'unsafe-inline'; img-src https: data: blob:; font-src https: data:; connect-src https:; media-src https: data:; form-action 'none'; frame-ancestors https://agentartifact.example.test"
      );
      expect(frame.headers.get('referrer-policy')).toBe('no-referrer');
      expect(frame.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(frame.headers.get('permissions-policy')).toBe(
        'camera=(), microphone=(), geolocation=(), payment=()'
      );
      expect(frame.headers.get('set-cookie')).toBeNull();
      expect(frameText).toContain('window.__cookie = document.cookie');

      const sandboxContent = await ctx.app.request(`${sandboxOrigin}/a/${shareId}/content`);
      expect(sandboxContent.status).toBe(404);
      expect(sandboxContent.headers.get('set-cookie')).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
