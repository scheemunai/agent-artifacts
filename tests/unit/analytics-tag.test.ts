import { renderToString } from 'hono/jsx/dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { appOriginCsp } from '../../src/app.js';
import type { ViewerContentResult, ViewerPageModel } from '../../src/services/viewer.js';
import { configureAnalytics, DATAFAST_ORIGIN, resetAnalytics } from '../../src/ui/analytics.js';
import { AnalyticsScript } from '../../src/ui/components/analytics-script.js';
import { Layout } from '../../src/ui/components/layout.js';
import { FrameDocument, FrameTerminalDocument } from '../../src/ui/pages/frame-document.js';
import { ViewerPage } from '../../src/ui/pages/viewer.js';

const SITE_ID = 'dfid_TESTonlyIdNotReal000';

afterEach(() => {
  resetAnalytics();
});

const content: ViewerContentResult = {
  shareId: 'AbCdEfGhIjKlMnOpQrStUv',
  accountId: 'acc_analytics',
  artifactId: 'art_analytics',
  slug: 'analytics-probe',
  type: 'markdown',
  title: 'Analytics probe',
  content: '# Probe',
  contentHash: 'hash-analytics',
  versionNum: 1,
  latestVersionNum: 1,
  updatedAt: 1_787_700_000_000,
  bot: null,
  passwordProtected: false,
  footer: true,
  isOwner: false,
  html: '<article class="aa-md"><h1>Probe</h1></article>',
  frameUrl: null,
};

const viewerModel: ViewerPageModel = {
  shareId: content.shareId,
  canonicalUrl: `https://agentartifact.ai/a/${content.shareId}`,
  passwordProtected: false,
  footer: true,
  isOwner: false,
  meta: {
    title: content.title,
    description: 'Published with Agent Artifacts',
    imageUrl: `https://agentartifact.ai/a/${content.shareId}/og.png`,
    canonicalUrl: `https://agentartifact.ai/a/${content.shareId}`,
    protected: false,
  },
  initialContent: content,
};

const enable = () =>
  configureAnalytics({ datafastSiteId: SITE_ID, baseUrl: 'https://agentartifact.ai' });

describe('the analytics tag is env-gated', () => {
  it('renders nothing at all when no site id is configured', () => {
    // The default state of a developer's laptop and of every self-host: no third-party script
    // appears in pages because we happened to ship one.
    expect(renderToString(AnalyticsScript()).trim()).toBe('');
    expect(renderToString(Layout({ title: 'Off', children: 'x' }))).not.toContain('datafa.st');
    expect(renderToString(ViewerPage({ model: viewerModel }))).not.toContain('datafa.st');
  });

  it('renders the tag with the id and the derived domain when one is set', () => {
    enable();
    const tag = renderToString(AnalyticsScript());

    expect(tag).toContain('defer');
    expect(tag).toContain(`data-website-id="${SITE_ID}"`);
    expect(tag).toContain('src="https://datafa.st/js/script.js"');
    // Derived from baseUrl, never hard-coded: a deployment that reports under a host it is not
    // served from is reporting a fiction.
    expect(tag).toContain('data-domain="agentartifact.ai"');
  });

  it('derives the domain per deployment rather than naming one', () => {
    configureAnalytics({ datafastSiteId: SITE_ID, baseUrl: 'https://staging.example.test:8443' });

    expect(renderToString(AnalyticsScript())).toContain('data-domain="staging.example.test:8443"');
  });

  it('treats an empty or blank id as off, not as a value', () => {
    configureAnalytics({ datafastSiteId: '', baseUrl: 'https://agentartifact.ai' });
    expect(renderToString(AnalyticsScript()).trim()).toBe('');

    configureAnalytics({ datafastSiteId: '   ', baseUrl: 'https://agentartifact.ai' });
    expect(renderToString(AnalyticsScript()).trim()).toBe('');
  });
});

/**
 * There are two document shells on the app origin. A tag mounted only in `Layout` would have
 * missed the public artifact page — the most visited surface the product has — while looking
 * entirely correct in a diff.
 */
describe('both app-origin document shells carry the tag', () => {
  it('mounts it in Layout, which renders the dashboard and marketing pages', () => {
    enable();
    const html = renderToString(Layout({ title: 'Dashboard', children: 'x' }));

    expect(html).toContain('src="https://datafa.st/js/script.js"');
    expect(html).toContain(`data-website-id="${SITE_ID}"`);
    // In the head, so it is discovered before the body is parsed.
    expect(html.indexOf('datafa.st')).toBeLessThan(html.indexOf('<body'));
  });

  it('mounts it in ViewerDocument, which builds its own head', () => {
    enable();
    const html = renderToString(ViewerPage({ model: viewerModel }));

    expect(html).toContain('src="https://datafa.st/js/script.js"');
    expect(html).toContain(`data-website-id="${SITE_ID}"`);
    expect(html.indexOf('datafa.st')).toBeLessThan(html.indexOf('<body'));
  });

  it('renders exactly one tag per document', () => {
    enable();

    for (const html of [
      renderToString(Layout({ title: 'Dashboard', children: 'x' })),
      renderToString(ViewerPage({ model: viewerModel })),
    ]) {
      expect(html.match(/datafa\.st\/js\/script\.js/g) ?? []).toHaveLength(1);
    }
  });
});

/**
 * The sandbox origin carries somebody else's HTML. Our analytics must not run beside it: it would
 * attribute the visit to the wrong page, and it would break the promise that a sandboxed artifact
 * loads nothing of ours.
 */
describe('the sandbox origin never carries the tag', () => {
  it('keeps it out of the artifact frame and its terminal states, even when enabled', () => {
    enable();

    const frame = FrameDocument({ content: '<p>Artifact.</p>', title: 'Artifact' });
    const terminal = FrameTerminalDocument({ status: 404, homeUrl: 'https://agentartifact.ai/' });

    expect(frame).not.toContain('datafa.st');
    expect(frame).not.toContain(SITE_ID);
    expect(terminal).not.toContain('datafa.st');
    expect(terminal).not.toContain(SITE_ID);
  });
});

describe('the app-origin CSP follows the switch', () => {
  it('stays tight when analytics is off', () => {
    const csp = appOriginCsp("'self'", undefined);

    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('datafa.st');
  });

  it('allows the analytics origin in script-src AND connect-src when on', () => {
    const csp = appOriginCsp("'self'", DATAFAST_ORIGIN);

    // Loading the script is only half of it: without connect-src the page fetches the script and
    // then silently drops every event, which looks like working analytics and reports nothing.
    expect(csp).toContain(`script-src 'self' ${DATAFAST_ORIGIN}`);
    expect(csp).toContain(`connect-src 'self' ${DATAFAST_ORIGIN}`);
  });

  it('widens nothing else', () => {
    const off = appOriginCsp("'self'", undefined).split('; ');
    const on = appOriginCsp("'self'", DATAFAST_ORIGIN).split('; ');

    expect(on).toHaveLength(off.length);
    const changed = on.filter((directive, index) => directive !== off[index]);
    expect(changed.map((directive) => directive.split(' ')[0])).toEqual([
      'script-src',
      'connect-src',
    ]);
  });
});
