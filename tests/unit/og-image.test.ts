import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOgDescription,
  clearOgImageCache,
  generateCachedOgImage,
  generateOgImage,
  getOgImageCacheStats,
  OG_DEFAULT_DESCRIPTION,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  stripUnsupportedOgGlyphs,
} from '../../src/lib/og.js';

interface PngDimensions {
  width: number;
  height: number;
}

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
    expect(stripUnsupportedOgGlyphs('Agent 🚀 Artifacts 世界 ◆')).toBe('Agent  Artifacts  ◆');
  });
});

function readPngDimensions(buffer: Buffer): PngDimensions {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
