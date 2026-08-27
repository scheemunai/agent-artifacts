import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOgDescription,
  buildOgFallbackSvg,
  buildOgSvg,
  clearOgImageCache,
  generateCachedOgImage,
  generateOgFallbackImage,
  generateOgImage,
  getOgImageCacheStats,
  OG_DEFAULT_DESCRIPTION,
  OG_FONT_FAMILY,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  OG_PALETTE,
  stripUnsupportedOgGlyphs,
} from '../../src/lib/og.js';
import { themeVariables } from '../support/css-cascade.js';

/** Which app.css design token each OG palette entry mirrors. */
const OG_TOKEN_FOR: Record<keyof typeof OG_PALETTE, string> = {
  air: '--color-aa-bg',
  ink: '--color-aa-ink',
  muted: '--color-aa-muted',
  line: '--color-aa-line',
  accent: '--color-aa-accent',
  accentInk: '--color-aa-accent-ink',
};

interface PngDimensions {
  width: number;
  height: number;
}

const REPO_ROOT = new URL('../../', import.meta.url);
const FALLBACK_PNG_PATH = repoPath('public/assets/og-fallback.png');

/** Colours from the pre-Fresh-Air brand. None of them may come back. */
const RETIRED_HEXES = ['#4f46e5', '#111827', '#6b7280'];

describe('OG image renderer', () => {
  beforeEach(() => {
    clearOgImageCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a deterministic 1200x630 PNG and makes zero network calls', async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error('network fetch forbidden during OG render');
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    try {
      const input = {
        title: 'Weekly Ops Report — W34 🚀',
        botName: 'R2',
        botByline: "Andrej's Chief of Staff 🤖",
      };
      const first = await generateOgImage(input);
      const second = await generateOgImage(input);

      expect(readPngDimensions(first)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
      expect(first.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
      expect(first.equals(second)).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('caches rendered cards by share id and content hash', async () => {
    const first = await generateCachedOgImage({
      shareId: 'share_1',
      contentHash: 'hash_1',
      title: 'First title',
      botName: 'R2',
      botByline: 'Chief of Staff',
    });
    const second = await generateCachedOgImage({
      shareId: 'share_1',
      contentHash: 'hash_1',
      title: 'Different title after cache hit',
      botName: 'Other',
      botByline: 'Other byline',
    });

    expect(second.equals(first)).toBe(true);
    expect(getOgImageCacheStats()).toMatchObject({ entries: 1, maxEntries: 128 });
  });

  it('uses the fixed HTML-artifact description and strips unsupported OG glyphs', () => {
    expect(buildOgDescription({ type: 'html', content: '<h1>Secret raw markup</h1>' })).toBe(
      OG_DEFAULT_DESCRIPTION
    );
    expect(
      buildOgDescription({ type: 'markdown', content: '# Title\n\nHello **world** [link](x)' })
    ).toBe('Title Hello world link');
    // U+25C6 is absent from the bundled Source Sans 3 latin subset, so it is dropped
    // rather than rasterised as a missing-glyph box.
    expect(stripUnsupportedOgGlyphs('Agent 🚀 Artifacts 世界 ◆')).toBe('Agent  Artifacts  ');
    expect(stripUnsupportedOgGlyphs("Ünicode · em—dash · 'curly' … done")).toBe(
      "Ünicode · em—dash · 'curly' … done"
    );
  });
});

describe('OG card brand', () => {
  it('paints the share card in Fresh Air and keeps the retired palette out', async () => {
    const svg = decodeSvgEntities(
      await buildOgSvg({
        title: 'Weekly Ops Report',
        botName: 'R2',
        botByline: "Andrej's Chief of Staff",
      })
    );

    // Air canvas, ink title, muted byline, hairline rule above the lockup.
    expect(svg).toContain(`fill="${OG_PALETTE.air}"`);
    expect(svg).toContain(`fill="${OG_PALETTE.ink}"`);
    expect(svg).toContain(`fill="${OG_PALETTE.muted}"`);
    expect(svg).toContain(`fill="${OG_PALETTE.line}"`);
    // Coral is the single accent: the top bar and the product mark, nothing else.
    expect(svg).toContain(`fill="${OG_PALETTE.accent}"`);

    for (const hex of RETIRED_HEXES) {
      expect(svg.toLowerCase()).not.toContain(hex);
    }
  });

  it('draws the product mark as the same vector paths as the ProductMark component', async () => {
    const svg = decodeSvgEntities(await buildOgSvg({ title: 'Agent Skill' }));
    const component = readFileSync(repoPath('src/ui/components/primitives.tsx'), 'utf8');

    for (const path of ['M6 6 H16 L26 16 V26 H6 Z', 'M16 6 L26 16 H16 Z']) {
      expect(svg).toContain(path);
      expect(component).toContain(path);
    }
    expect(svg).toContain('rotate(45 16 16)');
    expect(component).toContain('rotate(45 16 16)');
  });

  it('keeps the OG palette in step with the app.css design tokens', () => {
    // Each OG colour is checked against the *named* token it mirrors, not against the file as a
    // whole. Substring containment asked only "does this hex appear somewhere in app.css", which is
    // a weaker question than it looks: `#ffffff` appears twice today, as --color-aa-surface-raised
    // and --color-aa-accent-ink, so a drift in accent-ink was already masked by the other. The
    // guard passed for a reason unrelated to the thing it was guarding.
    const css = readFileSync(repoPath('src/ui/assets/app.css'), 'utf8');
    const tokens = themeVariables(css);

    // The mapping is a correspondence between two vocabularies, so it has to be written down — but
    // it must not be allowed to go stale: a palette entry added without a token named here fails
    // this line rather than being silently skipped by the loop below.
    expect(Object.keys(OG_TOKEN_FOR).sort(), 'OG_PALETTE and the token map disagree').toEqual(
      Object.keys(OG_PALETTE).sort()
    );

    for (const [key, hex] of Object.entries(OG_PALETTE)) {
      const token = OG_TOKEN_FOR[key as keyof typeof OG_PALETTE];
      expect(tokens.get(token), `${token} is not defined in app.css @theme`).toBeDefined();
      expect(tokens.get(token)?.toLowerCase(), `OG ${key} drifted from ${token}`).toBe(
        hex.toLowerCase()
      );
    }

    const lowerCss = css.toLowerCase();
    for (const hex of RETIRED_HEXES) {
      expect(lowerCss).not.toContain(hex);
    }
  });

  it('renders from bundled Source Sans 3 files with nothing left to fetch', () => {
    expect(OG_FONT_FAMILY).toBe('Source Sans 3');

    for (const filename of [
      'source-sans-3-latin-regular.ttf',
      'source-sans-3-latin-semibold.ttf',
    ]) {
      const path = repoPath(`src/ui/assets/fonts/${filename}`);
      expect(existsSync(path)).toBe(true);
      // satori parses raw font binaries: a woff2 (`wOF2`) would be rejected at render time.
      expect(readFileSync(path).subarray(0, 4).toString('latin1')).not.toBe('wOF2');
    }

    expect(readFileSync(repoPath('src/lib/og.ts'), 'utf8')).not.toContain('inter-latin');
  });
});

describe('OG fallback card', () => {
  it('exists at the path the viewer falls back to', () => {
    expect(readFileSync(repoPath('src/ui/pages/viewer.tsx'), 'utf8')).toContain(
      '/assets/og-fallback.png'
    );

    expect(existsSync(FALLBACK_PNG_PATH)).toBe(true);
    const png = readFileSync(FALLBACK_PNG_PATH);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect(readPngDimensions(png)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
  });

  it('is a brand-only card produced by the same pipeline', async () => {
    const svg = decodeSvgEntities(await buildOgFallbackSvg());

    expect(svg).toContain(`fill="${OG_PALETTE.air}"`);
    expect(svg).toContain(`fill="${OG_PALETTE.accent}"`);
    expect(svg).toContain(`fill="${OG_PALETTE.ink}"`);
    expect(svg).toContain('rotate(45 16 16)');
    // No artifact byline and no hairline rule: mark plus wordmark only.
    expect(svg).not.toContain(`fill="${OG_PALETTE.muted}"`);
    expect(svg).not.toContain(`fill="${OG_PALETTE.line}"`);

    const png = await generateOgFallbackImage();
    expect(readPngDimensions(png)).toEqual({ width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT });
  });
});

function repoPath(relative: string): string {
  return fileURLToPath(new URL(relative, REPO_ROOT));
}

/** satori inlines nested SVG as a URI-encoded data image, so unescape before asserting. */
function decodeSvgEntities(svg: string): string {
  return svg.replaceAll('%23', '#').replaceAll('%22', '"').replaceAll('%3E', '>');
}

function readPngDimensions(buffer: Buffer): PngDimensions {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
