import { describe, expect, it } from 'vitest';
import { createViewerTestContext, publishSharedArtifact } from './viewer-test-utils.js';

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/**
 * The viewer's ⭳ Download is an `href`, so it is a link a human clicks. Once the share token had
 * expired it answered with the API's own envelope — `{"error":{"code":"password_required"…}}` in
 * the browser's JSON viewer, with no chrome and no way onward.
 *
 * Same negotiation as the global handler: a browser gets the page, every other caller keeps the
 * envelope byte for byte.
 */
describe('protected download answers humans and machines differently', () => {
  it('sends a browser to a page that says what to do next', async () => {
    const ctx = await createViewerTestContext();
    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'protected-download',
        title: 'Protected download',
        password: 'hunter22hunter',
      });
      const shareId = created.share?.shareId as string;

      const response = await ctx.app.request(`/a/${shareId}/download`, {
        headers: { Accept: HTML_ACCEPT },
      });
      const html = await response.text();

      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).not.toContain('"error"');
      expect(html).toContain('password-protected');
      // A real action: the artifact page is where the password can be entered.
      expect(html).toContain(`/a/${shareId}`);
      expect(html).toContain('Open the artifact');
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps the envelope byte-identical for every other caller', async () => {
    const ctx = await createViewerTestContext();
    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'protected-download-api',
        title: 'Protected download',
        password: 'hunter22hunter',
      });
      const shareId = created.share?.shareId as string;

      const bodies: string[] = [];

      for (const headers of [{ Accept: 'application/json' }, { Accept: '*/*' }, {}]) {
        const response = await ctx.app.request(`/a/${shareId}/download`, { headers });

        expect(response.status, JSON.stringify(headers)).toBe(401);
        expect(response.headers.get('content-type'), JSON.stringify(headers)).toContain(
          'application/json'
        );
        bodies.push(await response.text());
      }

      // Compared as text, because "byte-identical" is what this test is named for and what an API
      // client can actually depend on. Parsing first and deep-comparing proves the three callers
      // agree on a *value*; it accepts a different key order, added whitespace, or a re-serialised
      // envelope — all of which are visible to anyone diffing responses or matching on the raw body.
      expect(new Set(bodies).size, `envelopes differ:\n${bodies.join('\n')}`).toBe(1);
      expect(bodies[0]).toBe(
        '{"error":{"code":"password_required","message":"Password required"}}'
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('leaves an unprotected download exactly as it was', async () => {
    const ctx = await createViewerTestContext();
    try {
      const created = await publishSharedArtifact(ctx, { slug: 'open-download' });
      const shareId = created.share?.shareId as string;

      const response = await ctx.app.request(`/a/${shareId}/download`, {
        headers: { Accept: HTML_ACCEPT },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/markdown');
      expect(response.headers.get('content-disposition')).toContain('attachment');
    } finally {
      await ctx.cleanup();
    }
  });
});
