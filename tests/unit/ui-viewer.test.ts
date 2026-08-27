import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import type { ViewerContentResult, ViewerPageModel } from '../../src/services/viewer.js';
import {
  VIEWER_SCRIPT_SRC,
  VIEWER_STYLESHEET_HREF,
  ViewerPage,
} from '../../src/ui/pages/viewer.js';

const htmlContent: ViewerContentResult = {
  shareId: 'AbCdEfGhIjKlMnOpQrStUv',
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
  canonicalUrl: `https://agentartifact.anacreon.ai/a/${htmlContent.shareId}`,
  passwordProtected: false,
  footer: true,
  meta: {
    title: htmlContent.title,
    description: 'Published with Agent Artifacts',
    imageUrl: `https://agentartifact.anacreon.ai/a/${htmlContent.shareId}/og.png`,
    canonicalUrl: `https://agentartifact.anacreon.ai/a/${htmlContent.shareId}`,
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
});
