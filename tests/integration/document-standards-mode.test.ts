import { describe, expect, it } from 'vitest';
import {
  createViewerTestContext,
  publishSharedArtifact,
  revokeShare,
} from './viewer/viewer-test-utils.js';

/**
 * Found while building the error page, not in any audit: **no server-rendered page in the product
 * emitted a doctype**. Hono's JSX renderer emits exactly the tree it is given, and every document
 * component started at `<html>`, so every response began `<html lang="en">` — which puts the
 * browser in quirks mode for the entire document.
 *
 * Quirks mode is not cosmetic: it changes the box model, percentage-height resolution, table cell
 * font inheritance and inline line-height. Every measurement anyone takes against these pages is
 * taken in the wrong rendering mode until this holds.
 */
describe('every HTML document is served in standards mode', () => {
  it('starts every server-rendered page with a doctype', async () => {
    const ctx = await createViewerTestContext();
    try {
      const live = await publishSharedArtifact(ctx, { slug: 'standards-mode-live' });
      const liveShareId = live.share?.shareId as string;

      const gone = await publishSharedArtifact(ctx, { slug: 'standards-mode-gone' });
      const goneShareId = gone.share?.shareId as string;
      revokeShare(ctx, goneShareId);

      const paths = [
        '/style-guide',
        '/login',
        '/setup',
        `/a/${liveShareId}`,
        `/a/${goneShareId}`,
        '/a/AbCdEfGhIjKlMnOpQrStUv',
      ];

      for (const path of paths) {
        const response = await ctx.app.request(path, {
          headers: { Accept: 'text/html,application/xhtml+xml' },
        });
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('text/html')) {
          continue;
        }

        const body = await response.text();
        expect(body.slice(0, 15).toLowerCase(), `${path} (${response.status})`).toBe(
          '<!doctype html>'
        );
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('starts a negotiated error page with a doctype too', async () => {
    const ctx = await createViewerTestContext();
    try {
      const response = await ctx.app.request('/no-such-page', {
        headers: { Accept: 'text/html' },
      });

      expect(response.status).toBe(404);
      expect((await response.text()).slice(0, 15).toLowerCase()).toBe('<!doctype html>');
    } finally {
      await ctx.cleanup();
    }
  });
});
