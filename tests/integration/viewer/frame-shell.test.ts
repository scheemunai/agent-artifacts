import { describe, expect, it } from 'vitest';
import { publicArtifactFrameHeaders } from '../../../src/lib/frame-policy.js';
import {
  createViewerTestContext,
  publishSharedArtifact,
  revokeShare,
} from './viewer-test-utils.js';

const UNKNOWN_SHARE_ID = 'AbCdEfGhIjKlMnOpQrStUv';
const FRAGMENT = '<h1>Weekly Ops</h1><p>The agent finished the work.</p>';

/**
 * `/a/:share_id/frame` is a public, directly navigable URL that carries half the product's
 * content. It used to return the agent's fragment raw — no doctype, no charset, no viewport, no
 * styling — and its terminal state was the two words `Not found` in bare monospace.
 *
 * The shell must fix the presentation without moving the security boundary one inch, so these
 * tests assert the wrapper and the byte-identical headers in the same breath.
 */
describe('sandboxed artifact frame shell', () => {
  it('wraps an agent fragment in a real document without changing the agent bytes', async () => {
    const ctx = await createViewerTestContext();
    try {
      const created = await publishSharedArtifact(ctx, {
        type: 'html',
        slug: 'fragment-artifact',
        title: 'Weekly Ops',
        content: FRAGMENT,
      });
      const shareId = created.share?.shareId as string;

      const response = await ctx.app.request(`/a/${shareId}/frame`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html.toLowerCase().startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain('width=device-width');
      expect(html).toContain('<title>Weekly Ops</title>');
      expect(html).toContain(FRAGMENT);
      expect(html).not.toContain('<script');

      // Security posture is unchanged: the same header set the policy module produces.
      for (const [name, value] of Object.entries(
        publicArtifactFrameHeaders({ config: ctx.config, passwordProtected: false })
      )) {
        expect(response.headers.get(name), name).toBe(value);
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('leaves an artifact that ships its own document completely alone', async () => {
    const ctx = await createViewerTestContext();
    try {
      const own =
        '<!doctype html><html lang="en"><head><title>Mine</title></head><body>Mine</body></html>';
      const created = await publishSharedArtifact(ctx, {
        type: 'html',
        slug: 'whole-document',
        title: 'Whole document',
        content: own,
      });
      const shareId = created.share?.shareId as string;

      const response = await ctx.app.request(`/a/${shareId}/frame`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(own);
    } finally {
      await ctx.cleanup();
    }
  });

  it('answers every terminal cause with a branded, self-contained document', async () => {
    const ctx = await createViewerTestContext();
    try {
      const revoked = await publishSharedArtifact(ctx, {
        type: 'html',
        slug: 'revoked-frame',
        title: 'Revoked frame',
        content: FRAGMENT,
      });
      const revokedShareId = revoked.share?.shareId as string;
      revokeShare(ctx, revokedShareId);

      const markdown = await publishSharedArtifact(ctx, {
        slug: 'markdown-has-no-frame',
        title: 'Markdown has no frame',
      });
      const markdownShareId = markdown.share?.shareId as string;

      const cases: Array<[string, number, string]> = [
        [`/a/${UNKNOWN_SHARE_ID}/frame`, 404, 'available here'],
        [`/a/${markdownShareId}/frame`, 404, 'available here'],
        [`/a/${revokedShareId}/frame`, 410, 'no longer available'],
      ];

      for (const [path, status, copy] of cases) {
        const response = await ctx.app.request(path);
        const html = await response.text();

        expect(response.status, path).toBe(status);
        expect(html, path).not.toBe('Not found');
        expect(html.toLowerCase().startsWith('<!doctype html>'), path).toBe(true);
        expect(html, path).toContain(copy);
        expect(html, path).toContain('<svg');
        expect(html, path).not.toContain('<script');
        expect(html, path).not.toContain('<link');
        expect(response.headers.get('content-type'), path).toBe('text/html; charset=utf-8');
        // A terminal response must never be cached as if it were an artifact.
        expect(response.headers.get('cache-control'), path).toBe('no-store');
        expect(response.headers.get('content-security-policy'), path).toContain(
          'sandbox allow-scripts'
        );
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('sends a password-protected frame to the gate instead of a JSON envelope', async () => {
    const ctx = await createViewerTestContext();
    try {
      const created = await publishSharedArtifact(ctx, {
        type: 'html',
        slug: 'protected-frame',
        title: 'Protected frame',
        content: FRAGMENT,
        password: 'hunter22hunter',
      });
      const shareId = created.share?.shareId as string;

      const response = await ctx.app.request(`/a/${shareId}/frame`);
      const html = await response.text();

      expect(response.status).toBe(401);
      expect(html).toContain('password-protected');
      expect(html).not.toContain('"error"');
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally {
      await ctx.cleanup();
    }
  });
});
