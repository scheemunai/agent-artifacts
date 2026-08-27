import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import type { ViewerContentResult, ViewerPageModel } from '../../src/services/viewer.js';
import {ViewerFooter, ViewerPage} from '../../src/ui/pages/viewer.js';
import { readClientSource } from '../support/client-assets.js';
import { declarationValue, parseStylesheet } from '../support/css-cascade.js';

/**
 * A failed refresh used to produce nothing at all. A pixel diff of the offline render against the
 * idle one came back differing in 5,118 pixels — every one of them inside the Download button's
 * hover fill. The page went on presenting stale content as live.
 *
 * Two causes, both fixed here: the script only handled `!response.ok`, and a hard network failure
 * makes `fetch` *reject*, which never reached that branch; and the one message it could produce was
 * a bare `<p class="aa-error">` prepended outside the prose column, full-bleed at x=0.
 */
const viewerScript = readClientSource('viewer.js');
const viewerCss = readClientSource('viewer.css');
const viewerRules = parseStylesheet(viewerCss);

const content: ViewerContentResult = {
  shareId: 'AbCdEfGhIjKlMnOpQrStUv',
  accountId: 'acc_status',
  artifactId: 'art_status',
  slug: 'weekly-ops',
  type: 'markdown',
  title: 'Weekly Ops Report',
  content: '# Weekly Ops',
  contentHash: 'hash-status',
  versionNum: 1,
  latestVersionNum: 1,
  updatedAt: 1_787_700_000_000,
  bot: null,
  passwordProtected: false,
  footer: true,
  html: '<article class="aa-md"><h1>Weekly Ops</h1></article>',
  frameUrl: null,
};

const model: ViewerPageModel = {
  shareId: content.shareId,
  canonicalUrl: 'https://example.test/a/AbCdEfGhIjKlMnOpQrStUv',
  passwordProtected: false,
  footer: true,
  meta: {
    title: content.title,
    description: 'Published with Agent Artifacts',
    imageUrl: 'https://example.test/a/AbCdEfGhIjKlMnOpQrStUv/og.png',
    canonicalUrl: 'https://example.test/a/AbCdEfGhIjKlMnOpQrStUv',
    protected: false,
  },
  initialContent: content,
};

const html = renderToString(ViewerPage({ model, abuseEmail: 'abuse@example.test' }));

describe('refresh failure is visible', () => {
  it('ships both failure states, rendered by the server and parked hidden', () => {
    expect(html).toContain('data-aa-viewer-status-region="true"');
    expect(html).toMatch(/data-aa-viewer-status="offline"[^>]*hidden/);
    expect(html).toMatch(/data-aa-viewer-status="stale"[^>]*hidden/);

    // Real Notices, so they carry the tone, the mark and the live region — not a bare <p>.
    expect(html).toContain('aa-notice--warn');
    expect(html).toContain('aa-notice--danger');
  });

  it('attaches the status to the chrome that owns the refresh control', () => {
    // The attached rung. Not a page-level banner, and not a toast region the viewer never had.
    const chrome = html.indexOf('data-aa-chrome="true"');
    const status = html.indexOf('data-aa-viewer-status-region');
    const contentRegion = html.indexOf('data-aa-content="true"');

    expect(chrome).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(chrome);
    expect(status).toBeLessThan(contentRegion);
    expect(html).not.toContain('aa-toast-region');
  });

  it('catches the rejection that used to escape entirely', () => {
    // `fetch` rejects on a hard network failure. Without a catch, nothing downstream ever ran.
    expect(viewerScript).toMatch(/catch\s*\{[\s\S]*?showViewerStatus\('offline'\)/);
    expect(viewerScript).toMatch(/showViewerStatus\('stale'\)/);
    // And it clears itself once a refresh succeeds, rather than accusing a working page.
    expect(viewerScript).toContain('clearViewerStatus()');
    // The old full-bleed <p class="aa-error"> is gone.
    expect(viewerScript).not.toContain('showInlineError');
  });

  it('keeps the copy on the server, where the component is', () => {
    for (const copy of ['You appear to be offline', 'Could not refresh this artifact']) {
      expect(html, copy).toContain(copy);
      expect(viewerScript, copy).not.toContain(copy);
    }
  });
});

describe('public footer links look like links', () => {
  it('underlines them at rest', () => {
    // They were muted, unweighted and undecorated — identical to the caption text around them.
    const rule = viewerRules.find((candidate) => candidate.selector === '.aa-viewer-footer a');
    expect(rule, 'no footer link rule').toBeDefined();
    expect(declarationValue(rule?.block ?? '', 'text-decoration')).toBe('underline');
  });

  it('matters most where the footer is only one link', () => {
    // On a paid plan the product footer goes and "Report abuse" is all that remains — the only
    // abuse affordance a public artifact page has.
    const paid = renderToString(
      ViewerFooter({ showProductFooter: false, abuseHref: 'mailto:abuse@example.test' })
    );

    expect(paid).toContain('Report abuse');
    expect(paid).not.toContain('aa-viewer-footer__brand');
    expect(paid.match(/<a\b/g) ?? []).toHaveLength(1);
  });
});
