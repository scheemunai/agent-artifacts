import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState, ProductMark } from '../../src/ui/components/primitives.js';
import { FrameTerminalDocument } from '../../src/ui/pages/frame-document.js';
import { ViewerFooter } from '../../src/ui/pages/viewer.js';

/**
 * Five marks shipped at once for one brand: the `ProductMark` SVG, a `◆` text glyph in
 * `EmptyState`, another in the viewer footer's "Made with ◆ Agent Artifacts", a third in the
 * client-side terminal card, and a solid indigo diamond in the live OG image.
 *
 * The SVG itself was also wrong. Its knock-out was painted `#FFFFFF` — the only hard-coded hex in
 * the component layer — so on the Fresh Air canvas (#f1f5f2) and in the drawer the notch rendered
 * *lighter* than its surroundings: a stray white shard that turned the diamond into a "◀" play
 * glyph rather than negative space.
 */
const primitives = readFileSync('src/ui/components/primitives.tsx', 'utf8');
const viewerScript = readFileSync('public/assets/viewer-0f4f9f6c8a7e.js', 'utf8');

/** Files this batch owns. The mark must be the component in every one of them. */
const OWNED_SOURCES = [
  'src/ui/components/primitives.tsx',
  'src/ui/components/version-banner.tsx',
  'src/ui/pages/viewer.tsx',
  'src/ui/pages/share-terminal.tsx',
  'src/ui/pages/error-page.tsx',
  'src/ui/pages/frame-document.ts',
  'src/ui/pages/style-guide.tsx',
  'public/assets/viewer-0f4f9f6c8a7e.js',
  'public/assets/ui-foundation-9ff54f825be4.js',
];

describe('ProductMark', () => {
  it('cuts the notch out instead of painting it white', () => {
    const html = renderToString(ProductMark());

    // One path, `evenodd`, so the notch is a real hole and shows whatever surface is behind it.
    expect(html.match(/<path/g) ?? []).toHaveLength(1);
    expect(html).toContain('fill-rule="evenodd"');
    expect(html).toContain('currentColor');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it('keeps the vector the OG card is pinned to', () => {
    const html = renderToString(ProductMark());

    for (const subpath of ['M6 6 H16 L26 16 V26 H6 Z', 'M16 6 L26 16 H16 Z']) {
      expect(html, subpath).toContain(subpath);
    }
    expect(html).toContain('rotate(45 16 16)');
  });
});

describe('one mark everywhere', () => {
  it('leaves no text-glyph mark in any file this batch owns', () => {
    for (const path of OWNED_SOURCES) {
      expect(readFileSync(path, 'utf8'), `${path} still ships a ◆ glyph`).not.toContain('◆');
    }
  });

  it('uses the component for the empty state ornament', () => {
    const html = renderToString(
      EmptyState({ title: 'No artifacts yet', description: 'Your bot creates them.' })
    );

    expect(html).toContain('aa-empty__icon');
    expect(html).toContain('<svg');
    expect(html).toContain('M6 6 H16 L26 16 V26 H6 Z');
  });

  it('uses the component in the viewer footer', () => {
    const html = renderToString(
      ViewerFooter({ showProductFooter: true, abuseHref: 'mailto:abuse@example.test' })
    );

    expect(html).toContain('<svg');
    expect(html).toContain('Agent Artifacts');
  });

  it('draws the same vector on the sandbox origin, which cannot import the component', () => {
    // The sandbox document is built as a string, outside JSX, and used to have no mark at all.
    expect(FrameTerminalDocument({ status: 404, homeUrl: 'https://example.test' })).toContain(
      'M6 6 H16 L26 16 V26 H6 Z'
    );
  });

  it('leaves the client script with no mark of its own to get wrong', () => {
    // The viewer's terminal card is now cloned from server-rendered markup, so the script has no
    // vector, no glyph and no opinion about the brand. See ui-terminal-parity.test.ts.
    expect(viewerScript).not.toContain('M6 6 H16 L26 16 V26 H6 Z');
    expect(viewerScript).not.toContain('aa-mark');
  });

  it('keeps the component as the single definition in JSX', () => {
    // Every JSX mark should route through ProductMark rather than re-declaring the vector.
    expect(primitives.match(/M6 6 H16 L26 16 V26 H6 Z/g) ?? []).toHaveLength(1);
  });
});
