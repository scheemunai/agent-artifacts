import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import type { ViewerContentResult, ViewerPageModel } from '../../src/services/viewer.js';
import { ViewerPage } from '../../src/ui/pages/viewer.js';
import { readClientSource } from '../support/client-assets.js';
import { parseStylesheet } from '../support/css-cascade.js';

const SHARE_ID = 'KbLJ0zvyiGadXLHUs2E5Rb';
/** Long on purpose: the title is the thing the phone header used to give away first. */
const LONG_TITLE = 'A long artifact title that would crowd a phone header';

const content: ViewerContentResult = {
  shareId: SHARE_ID,
  accountId: 'acc_ui_viewer_chrome',
  artifactId: 'art_chrome_probe',
  slug: 'chrome-probe',
  type: 'markdown',
  title: LONG_TITLE,
  content: '# Body',
  contentHash: 'hash-chrome-probe',
  versionNum: 3,
  latestVersionNum: 3,
  updatedAt: 1_787_700_000_000,
  bot: { name: 'Ops Bot', byline: 'nightly' },
  passwordProtected: false,
  footer: true,
  isOwner: false,
  html: '<div class="aa-md"><h1>Body</h1></div>',
  frameUrl: null,
};

const model: ViewerPageModel = {
  shareId: SHARE_ID,
  canonicalUrl: `https://example.test/a/${SHARE_ID}`,
  passwordProtected: false,
  footer: true,
  isOwner: false,
  meta: {
    title: LONG_TITLE,
    description: 'Published with Agent Artifacts',
    imageUrl: `https://example.test/a/${SHARE_ID}/og.png`,
    canonicalUrl: `https://example.test/a/${SHARE_ID}`,
    protected: false,
  },
  initialContent: content,
};

const html = renderToString(ViewerPage({ model }));
const viewerCss = readClientSource('viewer.css');
const viewerJs = readClientSource('viewer.js');
const cssRules = parseStylesheet(viewerCss);

function ruleFor(selector: string): string {
  return cssRules
    .filter((rule) => rule.selector === selector)
    .map((rule) => rule.block)
    .join('\n');
}

/**
 * `⭳` (U+2B33) and `↻` (U+21BB) are outside the coverage of the default UI fonts on Android and
 * older iOS. The two controls a reader is most likely to reach for rendered as tofu boxes on
 * exactly the devices most likely to be opening a shared link.
 */
describe('viewer chrome marks are drawn, not typed', () => {
  it('ships no font-dependent glyphs in the chrome', () => {
    expect(html).not.toContain('⭳');
    expect(html).not.toContain('↻');
    // The kebab too: `⋮` (U+22EE) has the same problem.
    expect(html).not.toContain('⋮');
  });

  it('draws each mark in the product icon style', () => {
    const icons = html.match(/<svg class="aa-viewer-icon"[\s\S]*?<\/svg>/g) ?? [];

    // Download, refresh, kebab.
    expect(icons.length).toBe(3);
    for (const icon of icons) {
      expect(icon).toContain('viewBox="0 0 24 24"');
      expect(icon).toContain('fill="none"');
      expect(icon).toContain('stroke="currentColor"');
      expect(icon).toContain('stroke-width="1.75"');
      expect(icon).toContain('aria-hidden="true"');
      // A mark with no accessible name must not be reachable as one.
      expect(icon).toContain('focusable="false"');
    }
  });

  it('keeps the download label beside its mark on desktop', () => {
    // Asserted on the label, not on a class name. This used to require `aa-viewer-download`, which
    // the button emitted and no stylesheet defined — so the assertion was pinning the presence of a
    // class that did nothing, and a guard that walks emissions for definitions now refuses it.
    expect(html).toMatch(/<svg[\s\S]*?<\/svg>\s*<span>Download<\/span>/);
  });

  it('lays a mark and its label out as a row, because the reset makes every svg a block', () => {
    // Caught in the browser, not here: `Button` wraps its children in one plain `<span>`, and with
    // `svg { display: block }` from the reset that span broke the line — the mark sat ABOVE the
    // word and the word overflowed the button onto the bar behind it. Measured at 1440: a 34px
    // button with its label's box ending at y=44.
    const row = ruleFor('.aa-viewer-chrome .aa-btn > span');

    expect(row, 'nothing makes the button label share a line with its mark').toContain(
      'display: inline-flex'
    );
    expect(row).toContain('align-items: center');
    expect(row).toContain('gap');
  });
});

describe('the refresh control shows that it is working', () => {
  it('spins the mark while the button reports itself busy', () => {
    const spin = ruleFor('.aa-viewer-refresh[aria-busy="true"] .aa-viewer-icon');

    expect(spin, 'no busy-state animation for the refresh mark').toContain('animation');
    expect(spin).toContain('aa-viewer-spin');
    expect(viewerCss).toContain('@keyframes aa-viewer-spin');
  });

  it('drives that state from the request, so it stops on success and on failure alike', () => {
    // `aria-busy` is set true before the fetch and cleared in a `finally`, so there is no path that
    // leaves the icon turning over a request that already ended.
    expect(viewerJs).toContain(
      "refreshButton.setAttribute('aria-busy', isBusy ? 'true' : 'false')"
    );
    expect(viewerJs).toMatch(/finally\s*{[\s\S]*setRefreshBusy\(false\)/);
  });

  it('stands the animation down for a reader who asked for less motion', () => {
    const reduced = cssRules.find(
      (rule) =>
        rule.selector === '.aa-viewer-refresh[aria-busy="true"] .aa-viewer-icon' &&
        rule.block.includes('animation: none')
    );

    expect(reduced, 'the spin is not disabled under prefers-reduced-motion').toBeDefined();
  });
});

/**
 * The phone header had a title, a version picker, a labelled Download and a refresh button on one
 * line. The title lost, every time.
 */
describe('the phone chrome moves the details behind one control', () => {
  it('offers a real toggle button, wired to the panel it controls', () => {
    expect(html).toContain('data-aa-menu-toggle="true"');
    expect(html).toContain('aria-controls="aa-viewer-menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Artifact details and actions"');
    expect(html).toContain('id="aa-viewer-menu"');
    expect(html).toContain('data-aa-menu-panel="true"');
  });

  it('is not a <details>, which cannot hold controls the page keeps updating', () => {
    // A closed disclosure is not laid out at all, and these are the same nodes the desktop bar
    // shows inline and `applyContent` rewrites on every poll.
    expect(html).not.toContain('<details');
    expect(html).not.toContain('::details-content');
  });

  it('keeps the panel in the document at both sizes rather than using [hidden]', () => {
    // `hidden` would take the version picker and Download out of the accessibility tree on desktop,
    // where this element is not a panel but the bar's own contents.
    expect(html).toContain('data-aa-open="false"');
    expect(html).not.toMatch(/<div class="aa-viewer-menu"[^>]*\shidden/);
    expect(ruleFor('.aa-viewer-menu')).toContain('display: contents');
    expect(ruleFor('.aa-viewer-menu[data-aa-open="false"]')).toContain('display: none');
  });

  it('renders one version picker for the owner, not one per arrangement', () => {
    const owner = renderToString(
      ViewerPage({
        model: { ...model, isOwner: true, initialContent: { ...content, isOwner: true } },
      })
    );

    expect(owner.match(/id="aa-version-picker"/g) ?? []).toHaveLength(1);
    expect(owner.match(/data-aa-download="true"/g) ?? []).toHaveLength(1);
  });

  it('gives a visitor who is not the owner no version picker at all', () => {
    // Not hidden — absent. A control that lists the history is itself a disclosure: it says how
    // many drafts there were, and invites a reader to try `?v=`.
    expect(html).not.toContain('aa-version-picker');
    expect(html).not.toContain('Artifact version');
    // Download is still theirs.
    expect(html.match(/data-aa-download="true"/g) ?? []).toHaveLength(1);
  });

  it('opens, closes on outside click and on Escape, and returns focus', () => {
    expect(viewerJs).toContain('installChromeMenu');
    expect(viewerJs).toContain("menuToggle.setAttribute('aria-expanded'");
    expect(viewerJs).toContain("event.key === 'Escape'");
    expect(viewerJs).toContain('menuToggle.focus()');
    expect(viewerJs).toContain('menuPanel.contains(event.target)');
    // Opening moves focus into the panel rather than leaving it on the page behind.
    expect(viewerJs).toMatch(/first instanceof HTMLElement[\s\S]*first\.focus\(\)/);
  });

  it('lets the title take the width the actions gave up', () => {
    // It was `flex: 0 1 auto` — content-sized, so the label and controls took theirs first.
    expect(ruleFor('.aa-viewer-chrome__lead')).toContain('flex: 1 1 auto');
    // And it still ellipsises rather than wrapping when a title is genuinely too long.
    expect(ruleFor('.aa-viewer-title')).toContain('text-overflow: ellipsis');
  });

  it('carries the whole title, which the bar above it has had to cut off', () => {
    expect(html).toContain('data-aa-menu-title="true"');
    expect(html).toContain(LONG_TITLE);
    // Wraps rather than ellipsising: this is the one place on a phone the full title can be read.
    const title = ruleFor('.aa-viewer-menu__title');
    expect(title).toContain('overflow-wrap: break-word');
    expect(title).not.toContain('text-overflow: ellipsis');
    // And it is not a second copy of the title in the bar on desktop, where `display: contents`
    // would otherwise lay it out as one more item in the row.
    const hiddenByDefault = cssRules.find(
      (rule) =>
        rule.selector.includes('.aa-viewer-menu__title') &&
        !rule.media &&
        rule.block.includes('display: none')
    );
    expect(hiddenByDefault, 'the panel title is not hidden outside the phone layout').toBeDefined();
  });

  it('lays the panel out as controls, not as a stack of full-width slabs', () => {
    // They were `width: 100%` in a grid — two small controls rendered as two full-bleed bars in a
    // panel whose whole job is to be compact.
    const actions = ruleFor('.aa-viewer-menu .aa-viewer-actions');
    expect(actions).toContain('display: flex');
    expect(actions).toContain('flex-wrap: wrap');

    expect(ruleFor('.aa-viewer-menu .aa-btn')).toContain('width: auto');
    expect(ruleFor('.aa-viewer-menu .aa-btn')).not.toContain('width: 100%');
    expect(ruleFor('.aa-viewer-menu .aa-viewer-version-select')).toContain('width: auto');
  });

  it('pads the panel equally on both sides', () => {
    // Stated as one shorthand so the two sides cannot drift apart without somebody meaning it.
    const panel = cssRules.find(
      (rule) => rule.selector === '.aa-viewer-menu' && rule.block.includes('position: absolute')
    );
    const padding = /(?:^|\s)padding:\s*([^;]+);/.exec(panel?.block ?? '')?.[1]?.trim();

    expect(padding, 'the phone panel sets no single padding value').toBeDefined();
    // One value = all four edges equal. Two or four values could be asymmetric.
    expect(padding?.split(/\s+/)).toHaveLength(1);
    expect(panel?.block).not.toMatch(/padding-(left|right|inline)/);
  });

  it('positions the panel over the page, so opening it shifts nothing', () => {
    const panel = cssRules.find(
      (rule) => rule.selector === '.aa-viewer-menu' && rule.block.includes('position: absolute')
    );

    expect(panel, 'the phone panel is not absolutely positioned').toBeDefined();
    expect(panel?.media, 'the panel should only be a panel on phones').toContain('560px');
  });
});
