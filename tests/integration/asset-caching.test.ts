import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { appPath } from '../../src/lib/runtime-paths.js';
import {
  type AssetKey,
  assetHref,
  isHashedAssetPath,
  isHashedMediaPath,
} from '../../src/ui/assets.js';
import { LAUNCH_VIDEO } from '../../src/ui/marketing-video-media.js';

/**
 * Caching a file forever is only honest when its URL changes with its contents. That became true
 * of the generated assets when the build started minting their names from a hash of their bytes;
 * before that, three of them had names describing bytes they no longer held, and `immutable` would
 * have pinned stale scripts into every cache that saw them.
 *
 * So the rule is a whitelist by shape, and the interesting half of this suite is the negative:
 * `/assets/` still holds files whose names survive their edits.
 */

const IMMUTABLE = 'public, max-age=31536000, immutable';
const ORIGIN = 'https://example.test';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'aa-asset-caching-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function testApp() {
  return createApp({
    config: loadConfig(
      { DEPLOYMENT: 'self-hosted', BASE_URL: ORIGIN, AA_SQLITE_PATH: './data/app.db' },
      { cwd }
    ),
    logger: pino({ enabled: false }),
  });
}

function hashedPath(key: AssetKey): string {
  const href = assetHref(key);
  expect(href, `run pnpm run build:assets before this suite (missing ${key})`).toBeDefined();
  return href as string;
}

describe('hashed assets', () => {
  it.each<AssetKey>([
    'app.css',
    'ui-foundation.js',
    'viewer.js',
    'viewer.css',
    'dashboard.js',
    'marketing-video.js',
  ])('lets a browser keep %s forever', async (key) => {
    const path = hashedPath(key);
    const response = await testApp().request(`${ORIGIN}${path}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(IMMUTABLE);
  });
});

describe('everything else under /assets', () => {
  // Each of these keeps its name across edits, so a year of immutable caching would strand the old
  // copy: og-fallback.png is regenerated on every OG repaint, build-missing.css is the diagnostic
  // that says the build did not run, and the web font is unhashed.
  it.each([
    '/assets/build-missing.css',
    '/assets/og-fallback.png',
    '/assets/fonts/source-sans-3-latin-var.woff2',
  ])('never tells a browser to keep %s forever', async (path) => {
    const response = await testApp().request(`${ORIGIN}${path}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).not.toBe(IMMUTABLE);
    expect(response.headers.get('cache-control') ?? '').not.toContain('immutable');
  });

  it('does not cache a miss forever either', async () => {
    const response = await testApp().request(`${ORIGIN}/assets/app-000000000000.css`);

    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control') ?? '').not.toContain('immutable');
  });
});

describe('the rest of the app', () => {
  it.each(['/style-guide', '/healthz'])('leaves %s alone', async (path) => {
    const response = await testApp().request(`${ORIGIN}${path}`);

    expect(response.headers.get('cache-control') ?? '').not.toContain('immutable');
  });
});

describe('the shape that qualifies', () => {
  it('is a content hash and nothing else', () => {
    for (const path of [
      '/assets/app-0f393d11f456.css',
      '/assets/ui-foundation-19583d78c148.js',
      '/assets/viewer-cb78d82c3186.css',
    ]) {
      expect(isHashedAssetPath(path), path).toBe(true);
    }

    for (const path of [
      '/assets/build-missing.css',
      '/assets/og-fallback.png',
      '/assets/fonts/source-sans-3-latin-var.woff2',
      '/assets/manifest.json',
      '/assets/app.css',
      // Too short, too long, not hex: a name that merely looks the part is not a promise.
      '/assets/app-0f393d11f45.css',
      '/assets/app-0f393d11f4567.css',
      '/assets/app-zzzzzzzzzzzz.css',
      '/assets/nested/app-0f393d11f456.css',
      '/style-guide',
    ]) {
      expect(isHashedAssetPath(path), path).toBe(false);
    }
  });
});

describe('content-addressed marketing media', () => {
  // HTTP fixture only, not an encoded movie. Real rendition decoding and seeking belong to the
  // browser suite. Unique bytes keep parallel tests from touching one another's temporary asset.
  const bytes = randomBytes(4096);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const path = `/assets/media/range-fixture.${hash}.mp4`;
  const disk = appPath(`public${path}`);
  beforeAll(() => {
    mkdirSync(appPath('public/assets/media'), { recursive: true });
    writeFileSync(disk, bytes, { flag: 'wx' });
  });
  afterAll(() => rmSync(disk));

  it('serves a real exact 206 range with length, type and immutable cache headers', async () => {
    const response = await testApp().request(`${ORIGIN}${path}`, {
      headers: { Range: 'bytes=0-1023' },
    });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-1023/4096');
    expect(response.headers.get('content-length')).toBe('1024');
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(0, 1024));
  });

  it('advertises ranges on HEAD and full GET without caching 416 errors', async () => {
    for (const method of ['HEAD', 'GET']) {
      const response = await testApp().request(`${ORIGIN}${path}`, { method });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-length')).toBe('4096');
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('cache-control')).toBe(IMMUTABLE);
      const actual = Buffer.from(await response.arrayBuffer());
      expect(actual).toEqual(method === 'HEAD' ? Buffer.alloc(0) : bytes);
    }
    const response = await testApp().request(`${ORIGIN}${path}`, {
      headers: { Range: 'bytes=4096-8191' },
    });
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */4096');
    expect(response.headers.get('cache-control') ?? '').not.toContain('immutable');
  });

  it('serves the timed visual transcript as WebVTT, not an octet-stream fallback', async () => {
    const response = await testApp().request(`${ORIGIN}${LAUNCH_VIDEO.captions}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/vtt; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe(IMMUTABLE);
    expect(await response.text()).toMatch(/^WEBVTT/);
  });

  it('keeps media caching isolated from canonical thumbnails, unhashed files and misses', async () => {
    for (const extension of ['mp4', 'webp', 'vtt']) {
      expect(isHashedMediaPath(`/assets/media/launch-phone.${hash}.${extension}`)).toBe(true);
    }
    for (const path of [
      '/assets/media/launch.mp4',
      '/assets/media/launch-pending.mp4',
      '/assets/media/launch-0000000000000.mp4',
      '/assets/template-thumbs/report.png',
      '/assets/launch-000000000000.mp4',
      '/assets/media/launch-000000000000.js',
      '/',
    ]) {
      expect(isHashedMediaPath(path), path).toBe(false);
    }
    const response = await testApp().request(`${ORIGIN}/assets/media/absent.0000000000000000.mp4`);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control') ?? '').not.toContain('immutable');
  });
});
