import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import type { ViewerContentResult, ViewerPageModel } from '../../src/services/viewer.js';
import { ShareTerminalPage } from '../../src/ui/pages/share-terminal.js';
import {
  VIEWER_SCRIPT_SRC,
  VIEWER_STYLESHEET_HREF,
  ViewerPage,
} from '../../src/ui/pages/viewer.js';

const htmlContent: ViewerContentResult = {
  shareId: 'AbCdEfGhIjKlMnOpQrStUv',
  accountId: 'acc_ui_viewer',
  artifactId: 'art_html_short',
  slug: 'short-html',
  type: 'html',
  title: 'Short HTML artifact',
  content: '<p>Done.</p>',
  contentHash: 'hash-html-short',
  versionNum: 2,
  latestVersionNum: 2,
  updatedAt: 1_787_700_000_000,
  bot: { name: 'QA Bot', byline: 'polish tester' },
  passwordProtected: false,
  footer: true,
  html: null,
  frameUrl: '/a/AbCdEfGhIjKlMnOpQrStUv/frame',
};

const model: ViewerPageModel = {
  shareId: htmlContent.shareId,
  canonicalUrl: `https://example.test/a/${htmlContent.shareId}`,
  passwordProtected: false,
  footer: true,
  meta: {
    title: htmlContent.title,
    description: 'Published with Agent Artifacts',
    imageUrl: `https://example.test/a/${htmlContent.shareId}/og.png`,
    canonicalUrl: `https://example.test/a/${htmlContent.shareId}`,
    protected: false,
  },
  initialContent: htmlContent,
};

describe('viewer page UI polish', () => {
  it('gives the icon-only refresh control an accessible name and tooltip', () => {
    const html = renderToString(ViewerPage({ model, abuseEmail: 'abuse@example.test' }));

    expect(html).toContain('data-aa-refresh="true"');
    expect(html).toContain('aria-label="Refresh artifact"');
    expect(html).toContain('title="Refresh artifact"');
  });

  it('keeps viewer chrome titles out of the document h1 hierarchy', () => {
    const markdownModel: ViewerPageModel = {
      ...model,
      initialContent: {
        ...htmlContent,
        type: 'markdown',
        html: '<article class="aa-md"><h1>Artifact-owned heading</h1><p>Done.</p></article>',
        frameUrl: null,
      },
    };
    const html = renderToString(
      ViewerPage({ model: markdownModel, abuseEmail: 'abuse@example.test' })
    );

    expect(html).toContain('class="aa-viewer-title"');
    expect(html).not.toContain('data-aa-title="true">Short HTML artifact</h1>');
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
  });

  it('keeps HTML artifacts sandboxed while enabling safe frame-height handshakes', () => {
    const html = renderToString(ViewerPage({ model, abuseEmail: 'abuse@example.test' }));
    const viewerScript = readFileSync(`public${VIEWER_SCRIPT_SRC}`, 'utf8');
    const viewerCss = readFileSync(`public${VIEWER_STYLESHEET_HREF}`, 'utf8');

    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('data-aa-frame-height="default"');
    expect(viewerScript).toContain("data.type !== 'aa:frame-height'");
    expect(viewerScript).toContain('candidate.contentWindow === event.source');
    expect(viewerScript).toContain('FRAME_MAX_HEIGHT = 2400');
    expect(viewerCss).toContain('height: clamp(18rem, 48vh, 34rem)');
    expect(viewerCss).toMatch(/\.aa-viewer\s*{\s*min-height: 0;/);
    expect(viewerCss).toMatch(/\.aa-viewer-document\s*{\s*min-height: 0;/);
  });

  it('guards refresh polling while a content request is in flight', () => {
    const viewerScript = readFileSync(`public${VIEWER_SCRIPT_SRC}`, 'utf8');

    expect(viewerScript).toContain('let contentRequestInFlight = false;');
    expect(viewerScript).toContain('if (contentRequestInFlight) {');
    expect(viewerScript).toContain("url.searchParams.set('poll', '1')");
    expect(viewerScript).toContain('setRefreshBusy(true);');
    expect(viewerScript).toContain('contentRequestInFlight = false;');
  });

  it('renders terminal pages with retry and home affordances', () => {
    const viewerScript = readFileSync(`public${VIEWER_SCRIPT_SRC}`, 'utf8');
    const html = renderToString(
      ShareTerminalPage({
        title: 'This link has been revoked.',
        message: 'The owner turned off sharing for this artifact.',
        status: 410,
        shareUrl: 'https://example.test/a/AbCdEfGhIjKlMnOpQrStUv',
        abuseEmail: 'abuse@example.test',
      })
    );

    expect(html).toContain('data-aa-terminal="true"');
    expect(html).toContain('Try again');
    expect(html).toContain('Go home');
    expect(html).toContain('aa-viewer-terminal-actions');
    expect(viewerScript).toContain('aa-viewer-terminal-actions');
  });
});
