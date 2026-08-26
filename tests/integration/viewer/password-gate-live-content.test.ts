import { describe, expect, it } from 'vitest';
import {
  createViewerTestContext,
  publishSharedArtifact,
  rotatePasswordTimestamp,
  updateArtifact,
} from './viewer-test-utils.js';

describe('viewer password gate live content', () => {
  it('withholds protected metadata pre-verify and serves the live latest content after verify', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'protected-report',
        title: 'Secret Report v1',
        content: '# Secret Report\n\nLegacy v1 content',
        password: 'correct horse battery staple',
      });
      const shareId = created.share?.shareId;
      expect(shareId).toBeDefined();

      await updateArtifact(ctx, {
        slug: 'protected-report',
        title: 'Secret Report v2',
        content: '# Secret Report\n\nLIVE V2 CONTENT',
        bot: created.bot,
      });

      const page = await ctx.app.request(`/a/${shareId}`);
      const pageHtml = await page.text();
      expect(page.status).toBe(200);
      expect(pageHtml).toContain('This artifact is password-protected.');
      expect(pageHtml).toContain('Protected artifact');
      expect(pageHtml).not.toContain('Secret Report v1');
      expect(pageHtml).not.toContain('Secret Report v2');
      expect(pageHtml).not.toContain('LIVE V2 CONTENT');
      expect(pageHtml).not.toContain(created.artifact.contentHash);

      const preVerifyJson = await ctx.app.request(`/a/${shareId}/content`);
      expect(preVerifyJson.status).toBe(401);
      await expect(preVerifyJson.json()).resolves.toEqual({
        error: { code: 'password_required', message: 'Password required' },
      });

      const wrong = await ctx.app.request(`/a/${shareId}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong password' }),
      });
      expect(wrong.status).toBe(401);

      const verified = await ctx.app.request(`/a/${shareId}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'correct horse battery staple' }),
      });
      const setCookie = verified.headers.get('set-cookie') ?? '';
      const verifyBody = (await verified.json()) as { viewer_token: string; expires_at: string };
      expect(verified.status).toBe(200);
      expect(setCookie).toContain('aa_sa=');
      expect(setCookie).toContain(`Path=/a/${shareId}`);
      expect(setCookie).toContain('Max-Age=900');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).toContain('Secure');
      expect(verifyBody.viewer_token).toMatch(/^[0-9]+\.[a-f0-9]{64}$/);
      expect(new Date(verifyBody.expires_at).getTime()).toBeGreaterThan(Date.now());

      const tokenContent = await ctx.app.request(`/a/${shareId}/content`, {
        headers: { 'X-AA-Share-Token': verifyBody.viewer_token },
      });
      const tokenJson = (await tokenContent.json()) as { html: string; version_num: number };
      expect(tokenContent.status).toBe(200);
      expect(tokenJson.version_num).toBe(2);
      expect(tokenJson.html).toContain('LIVE V2 CONTENT');
      expect(tokenJson.html).not.toContain('Legacy v1 content');

      rotatePasswordTimestamp(ctx, shareId as string);
      const staleToken = await ctx.app.request(`/a/${shareId}/content`, {
        headers: { 'X-AA-Share-Token': verifyBody.viewer_token },
      });
      expect(staleToken.status).toBe(401);
    } finally {
      await ctx.cleanup();
    }
  });

  it('rate limits password attempts to ten per fifteen minutes per share and IP', async () => {
    const ctx = await createViewerTestContext({ rateLimitsDisabled: false });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'rate-limited-secret',
        password: 'super secret',
      });
      const shareId = created.share?.shareId;
      expect(shareId).toBeDefined();

      for (let index = 0; index < 10; index += 1) {
        const response = await ctx.app.request(`/a/${shareId}/verify-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Real-IP': '203.0.113.10' },
          body: JSON.stringify({ password: `wrong-${index}` }),
        });
        expect(response.status).toBe(401);
      }

      const limited = await ctx.app.request(`/a/${shareId}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Real-IP': '203.0.113.10' },
        body: JSON.stringify({ password: 'super secret' }),
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    } finally {
      await ctx.cleanup();
    }
  });
});
