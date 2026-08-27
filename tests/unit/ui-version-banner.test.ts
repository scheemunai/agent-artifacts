import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import type { ViewerContentResult, ViewerPageModel } from '../../src/services/viewer.js';
import { isPinnedVersion, VersionBanner } from '../../src/ui/components/version-banner.js';
import { ViewerPage } from '../../src/ui/pages/viewer.js';
import { readClientSource } from '../support/client-assets.js';

/**
 * The banner is a *pinned-version* affordance: "you are not looking at the current document, here
 * is the way back". On the latest version there is nothing to go back to, so it announced
 * "Viewing v2 of v2" and offered a "View latest" link pointing at the page the reader was already
 * on — a control that cannot do anything, which is exactly what Part C's C14 forbids.
 *
 * The server gated the initial `hidden` on "a version was pinned in the URL"; the client script
 * un-hid it on any picker change without comparing to the latest version. Two implementations of
 * one decision, and they disagreed. Now there is one predicate, and both call it.
 */
const viewerScript = readClientSource('viewer.js');

const content: ViewerContentResult = {
  shareId: 'AbCdEfGhIjKlMnOpQrStUv',
  accountId: 'acc_version_banner',
  artifactId: 'art_versions',
  slug: 'versioned',
  type: 'markdown',
  title: 'Versioned artifact',
  content: '# Versioned',
  contentHash: 'hash-versioned',
  versionNum: 2,
  latestVersionNum: 2,
  updatedAt: 1_787_700_000_000,
  bot: null,
  passwordProtected: false,
  footer: true,
  html: '<article class="aa-md"><h1>Versioned</h1></article>',
  frameUrl: null,
};

const model: ViewerPageModel = {
  shareId: content.shareId,
  canonicalUrl: `https://example.test/a/${content.shareId}`,
  passwordProtected: false,
  footer: true,
  meta: {
    title: content.title,
    description: 'Published with Agent Artifacts',
    imageUrl: `https://example.test/a/${content.shareId}/og.png`,
    canonicalUrl: `https://example.test/a/${content.shareId}`,
    protected: false,
  },
  initialContent: content,
};

describe('isPinnedVersion', () => {
  it('is true only when the reader is looking at something other than the latest', () => {
    expect(isPinnedVersion(1, 2)).toBe(true);
    expect(isPinnedVersion(2, 3)).toBe(true);

    expect(isPinnedVersion(2, 2)).toBe(false);
    expect(isPinnedVersion(1, 1)).toBe(false);
    expect(isPinnedVersion(null, 2)).toBe(false);
    expect(isPinnedVersion(undefined, 2)).toBe(false);
    expect(isPinnedVersion(0, 2)).toBe(false);
    expect(isPinnedVersion(Number.NaN, 2)).toBe(false);
  });
});

describe('VersionBanner', () => {
  it('states which version is pinned and offers the way back', () => {
    const html = renderToString(
      VersionBanner({ shownVersion: 1, latestVersion: 3, canonicalUrl: '/a/abc' })
    );

    expect(html).toContain('Viewing v1 of v3');
    expect(html).toContain('View latest');
    expect(html).toContain('data-aa-pinned="true"');
    expect(html).not.toMatch(/<div[^>]*aa-viewer-version-banner[^>]*hidden/);
  });

  it('hides the banner and the link together on the latest version', () => {
    const html = renderToString(
      VersionBanner({ shownVersion: 2, latestVersion: 2, canonicalUrl: '/a/abc' })
    );

    expect(html).toContain('data-aa-pinned="false"');
    expect(html).toMatch(/<div[^>]*aa-viewer-version-banner[^>]*hidden/);
    // The link must be hidden in its own right, so no state can leave a dead control on screen.
    expect(html).toMatch(/<a[^>]*data-aa-view-latest="true"[^>]*hidden/);
    expect(html).not.toContain('Viewing v2 of v2');
  });
});

describe('viewer page', () => {
  it('shows no banner when the pinned version is the latest version', () => {
    const html = renderToString(
      ViewerPage({ model, abuseEmail: 'abuse@example.test', pinnedVersion: 2 })
    );

    expect(html).not.toContain('Viewing v2 of v2');
    expect(html).toContain('data-aa-pinned="false"');
  });

  it('shows the banner when an older version is pinned', () => {
    const html = renderToString(
      ViewerPage({ model, abuseEmail: 'abuse@example.test', pinnedVersion: 1 })
    );

    expect(html).toContain('Viewing v1 of v2');
    expect(html).toContain('data-aa-pinned="true"');
  });
});

describe('viewer script', () => {
  it('applies the same predicate, to the banner and the link alike', () => {
    expect(viewerScript).toContain('function isPinnedVersion');
    expect(viewerScript).toMatch(/viewLatestLink\.hidden\s*=\s*!pinned/);
    expect(viewerScript).toMatch(/versionBanner\.hidden\s*=\s*!pinned/);
    // The old bug in one line: hiding was decided by "a version is pinned" alone.
    expect(viewerScript).not.toMatch(/versionBanner\.hidden\s*=\s*!pinnedVersion\s*;/);
  });
});
