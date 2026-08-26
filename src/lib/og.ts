import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import satori, { type FontWeight, init as initSatori } from 'satori/standalone';
import { LruCache, type LruCacheStats } from './render-cache.js';

export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_DEFAULT_DESCRIPTION = 'Published with Agent Artifacts';
export const OG_CACHE_MAX_ENTRIES = 128;
export const OG_CACHE_MAX_BYTES = 64 * 1024 * 1024;

const PRODUCT_MARK = '◆ Agent Artifacts';
const TITLE_FONT_WEIGHT = 650 as unknown as FontWeight;
const FONT_DIR_FROM_MODULE = new URL('../ui/assets/fonts/', import.meta.url);
const requireFromHere = createRequire(import.meta.url);
const REGULAR_FONT_FILENAME = 'inter-latin-regular.ttf';
const SEMIBOLD_FONT_FILENAME = 'inter-latin-semibold.ttf';

export interface OgImageInput {
  title: string;
  botName?: string | null;
  botByline?: string | null;
}

export interface CachedOgImageInput extends OgImageInput {
  shareId: string;
  contentHash: string;
}

export interface OgDescriptionInput {
  type: 'markdown' | 'html';
  content?: string | null;
}

type OgChild = OgNode | string | number | null | undefined | OgChild[];

interface OgNode {
  type: string;
  props: Record<string, unknown>;
}

const ogImageCache = new LruCache<Buffer>({
  maxBytes: OG_CACHE_MAX_BYTES,
  maxEntries: OG_CACHE_MAX_ENTRIES,
  sizeOf: (value) => value.byteLength,
});

let fontBuffers: { regular: Buffer; semibold: Buffer } | undefined;
let satoriInitPromise: Promise<void> | undefined;

export async function generateOgImage(input: OgImageInput): Promise<Buffer> {
  const title = normalizeOgText(input.title, 'Untitled artifact', 92);
  const byline = normalizeOgText(formatByline(input), OG_DEFAULT_DESCRIPTION, 120);
  const fonts = loadInterFonts();
  await ensureSatoriInitialized();

  const svg = await satori(createOgTree({ title, byline }), {
    width: OG_IMAGE_WIDTH,
    height: OG_IMAGE_HEIGHT,
    fonts: [
      { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: fonts.semibold, weight: TITLE_FONT_WEIGHT, style: 'normal' },
    ],
    embedFont: true,
    loadAdditionalAsset: async () => [],
  });

  const png = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: {
      loadSystemFonts: false,
      fontFiles: [resolveFontPath(REGULAR_FONT_FILENAME), resolveFontPath(SEMIBOLD_FONT_FILENAME)],
      defaultFontFamily: 'Inter',
    },
    logLevel: 'off',
  })
    .render()
    .asPng();

  return Buffer.from(png);
}

export async function generateCachedOgImage(input: CachedOgImageInput): Promise<Buffer> {
  return ogImageCache.getOrSetAsync(ogCacheKey(input.shareId, input.contentHash), () =>
    generateOgImage(input)
  );
}

export function buildOgDescription(input: OgDescriptionInput): string {
  if (input.type === 'html') {
    return OG_DEFAULT_DESCRIPTION;
  }

  const text = stripMarkdownForDescription(input.content ?? '');
  return truncateAtWordBoundary(normalizeOgText(text, OG_DEFAULT_DESCRIPTION, 180), 180);
}

export function stripUnsupportedOgGlyphs(value: string): string {
  return Array.from(value)
    .filter((character) => isSupportedOgCodePoint(character.codePointAt(0)))
    .join('');
}

export function clearOgImageCache(): void {
  ogImageCache.clear();
}

export function getOgImageCacheStats(): LruCacheStats {
  return ogImageCache.stats();
}

export function ogCacheKey(shareId: string, contentHash: string): string {
  return `${shareId}\0${contentHash}`;
}

function createOgTree({ title, byline }: { title: string; byline: string }): OgNode {
  return element(
    'div',
    {
      style: {
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        backgroundColor: '#ffffff',
        color: '#111827',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter',
      },
    },
    element('div', {
      style: {
        display: 'flex',
        height: 10,
        width: '100%',
        backgroundColor: '#4f46e5',
        flexShrink: 0,
      },
    }),
    element(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'column',
          height: OG_IMAGE_HEIGHT - 10,
          padding: '74px 86px 58px 86px',
        },
      },
      element(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            maxWidth: 990,
            height: 230,
            overflow: 'hidden',
          },
        },
        element(
          'div',
          {
            style: {
              display: 'flex',
              color: '#111827',
              fontSize: 68,
              fontWeight: 650,
              letterSpacing: '-0.045em',
              lineHeight: 1.04,
            },
          },
          title
        )
      ),
      element(
        'div',
        {
          style: {
            display: 'flex',
            color: '#6b7280',
            fontSize: 30,
            fontWeight: 400,
            lineHeight: 1.35,
            marginTop: 34,
            maxWidth: 940,
            overflow: 'hidden',
          },
        },
        byline
      ),
      element(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            color: '#4f46e5',
            fontSize: 25,
            fontWeight: 650,
            letterSpacing: '-0.02em',
            marginTop: 'auto',
          },
        },
        PRODUCT_MARK
      )
    )
  );
}

function element(type: string, props: Record<string, unknown>, ...children: OgChild[]): OgNode {
  return {
    type,
    props: {
      ...props,
      children: children.length === 1 ? children[0] : children,
    },
  };
}

function ensureSatoriInitialized(): Promise<void> {
  satoriInitPromise ??= initSatori(readFileSync(requireFromHere.resolve('satori/yoga.wasm')));
  return satoriInitPromise;
}

function loadInterFonts(): { regular: Buffer; semibold: Buffer } {
  if (!fontBuffers) {
    fontBuffers = {
      regular: readFileSync(resolveFontPath(REGULAR_FONT_FILENAME)),
      semibold: readFileSync(resolveFontPath(SEMIBOLD_FONT_FILENAME)),
    };
  }

  return fontBuffers;
}

function resolveFontPath(filename: string): string {
  const candidates = [
    fileURLToPath(new URL(filename, FONT_DIR_FROM_MODULE)),
    `${process.cwd()}/src/ui/assets/fonts/${filename}`,
    `${process.cwd()}/dist/ui/assets/fonts/${filename}`,
  ];

  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    throw new Error(`Missing bundled Inter font: ${filename}`);
  }

  return match;
}

function formatByline(input: OgImageInput): string {
  const botName = normalizeOgText(input.botName ?? '', '', 80);
  const botByline = normalizeOgText(input.botByline ?? '', '', 100);

  if (botName && botByline) {
    return `by ${botName} · ${botByline}`;
  }

  if (botName) {
    return `by ${botName}`;
  }

  if (botByline) {
    return botByline;
  }

  return OG_DEFAULT_DESCRIPTION;
}

function normalizeOgText(value: string, fallback: string, maxCharacters: number): string {
  const normalized = stripUnsupportedOgGlyphs(value.replace(/\s+/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return ellipsize(normalized || fallback, maxCharacters);
}

function stripMarkdownForDescription(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~>#-]+/g, ' ')
    .replace(/<[^>]*>/g, ' ');
}

function truncateAtWordBoundary(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  const slice = value.slice(0, maxCharacters - 1);
  const boundary = slice.lastIndexOf(' ');
  if (boundary < Math.floor(maxCharacters * 0.65)) {
    return `${slice.trimEnd()}…`;
  }

  return `${slice.slice(0, boundary).trimEnd()}…`;
}

function ellipsize(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  return `${value.slice(0, maxCharacters - 1).trimEnd()}…`;
}

function isSupportedOgCodePoint(codePoint: number | undefined): boolean {
  if (codePoint === undefined) {
    return false;
  }

  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xff) ||
    codePoint === 0x2013 ||
    codePoint === 0x2014 ||
    codePoint === 0x2018 ||
    codePoint === 0x2019 ||
    codePoint === 0x201c ||
    codePoint === 0x201d ||
    codePoint === 0x2022 ||
    codePoint === 0x2026 ||
    codePoint === 0x25c6
  );
}
