import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { type AssetKey, assetHref, isHashedAssetPath } from '../../src/ui/assets.js';

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
  it.each<AssetKey>(['app.css', 'ui-foundation.js', 'viewer.js', 'viewer.css', 'dashboard.js'])(
    'lets a browser keep %s forever',
    async (key) => {
      const path = hashedPath(key);
      const response = await testApp().request(`${ORIGIN}${path}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe(IMMUTABLE);
    }
  );
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
