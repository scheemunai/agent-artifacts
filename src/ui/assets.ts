import { existsSync, type FSWatcher, readFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { appPath, shippedPathCandidates } from '../lib/runtime-paths.js';

/**
 * Served when the CSS build has not run. Unlike a hashed `app-<hash>.css` href, this file is
 * checked in, so the browser gets a real 200 with a banner that names the missing build step
 * instead of a silent 404 and a completely unstyled page.
 */
export const BUILD_MISSING_STYLESHEET_HREF = '/assets/build-missing.css';

const MANIFEST_FILENAME = 'manifest.json';
const STYLESHEET_KEY = 'app.css';
const BUILD_COMMAND = 'pnpm run build:assets';

/**
 * Every hashed asset a page may ask for. The names match the keys `scripts/build-assets.mjs`
 * writes, and the union is what stops a page naming an asset the build does not produce.
 */
export type AssetKey = 'app.css' | 'ui-foundation.js' | 'viewer.js' | 'dashboard.js' | 'viewer.css';

/** Mirrors the static root `src/app.ts` serves `/assets/*` from. Both resolve from the install. */
const servedPublicRoot = (): string => appPath('public');

export interface AssetResolverOptions {
  /** Directories that may hold `manifest.json`, in priority order. */
  assetRoots: readonly string[];
  /** Directory the HTTP layer serves `/assets/*` from, used to detect hrefs that would 404. */
  servedRoot: string | (() => string);
  /** Receives one message per distinct problem, once per process. */
  report: (message: string) => void;
  /** Drop cached hrefs when the manifest is rewritten, so a dev rebuild is picked up. */
  watchForRebuilds?: boolean;
}

/**
 * Builds an `assetHref()`. Exported so tests can point the resolver at a fixture tree and assert
 * the failure modes without touching the repository's real build output.
 *
 * Returns `undefined` for an asset the build has not produced. Pages must then omit the reference
 * entirely: an `src` or `href` that 404s is the failure this whole module exists to prevent, and
 * for scripts there is no honest fallback to serve in its place.
 */
export function createAssetResolver(
  options: AssetResolverOptions
): (key: AssetKey) => string | undefined {
  const { assetRoots, servedRoot, report, watchForRebuilds = true } = options;
  const reported = new Set<string>();
  const cache = new Map<AssetKey, string>();
  let watcher: FSWatcher | undefined;

  const reportOnce = (id: string, message: string): void => {
    if (reported.has(id)) {
      return;
    }
    reported.add(id);
    report(message);
  };

  const watchManifest = (manifestPath: string): void => {
    if (watcher || !watchForRebuilds) {
      return;
    }

    try {
      watcher = watch(manifestPath, () => {
        cache.clear();
        watcher?.close();
        watcher = undefined;
      });
      // A stale href is worth a watcher, never a process that will not exit.
      watcher.unref();
    } catch {
      // Watching is a development convenience. Platforms without inotify keep the cached hrefs.
    }
  };

  return function assetHref(key: AssetKey): string | undefined {
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const manifestPath = assetRoots
      .map((root) => join(root, MANIFEST_FILENAME))
      .find((candidate) => existsSync(candidate));

    if (!manifestPath) {
      reportOnce('missing-manifest', missingManifestMessage(assetRoots));
      // Deliberately not cached: the next render picks the asset up once the build lands.
      return undefined;
    }

    const href = readAssetHref(manifestPath, key);
    if (!href) {
      reportOnce(`missing-key:${key}`, missingKeyMessage(key, manifestPath));
      return undefined;
    }

    const served = typeof servedRoot === 'function' ? servedRoot() : servedRoot;
    if (!existsSync(join(served, href))) {
      reportOnce(`unservable:${key}`, unservableMessage(key, href, served, manifestPath));
    }

    watchManifest(manifestPath);
    cache.set(key, href);
    return href;
  };
}

/**
 * The href a page puts in `src`/`href`. Reads `manifest.json` at most once per process (until a
 * rebuild rewrites it) instead of on every render.
 */
export const assetHref: (key: AssetKey) => string | undefined = createAssetResolver({
  assetRoots: shippedPathCandidates('public/assets'),
  servedRoot: servedPublicRoot,
  report: (message) => {
    process.stderr.write(`${message}\n`);
  },
});

/**
 * The stylesheet is the one asset with an honest fallback: a checked-in file that renders a
 * "stylesheet not built" banner, so an unbuilt app looks broken on purpose rather than by accident.
 */
export function stylesheetHref(): string {
  return assetHref(STYLESHEET_KEY) ?? BUILD_MISSING_STYLESHEET_HREF;
}

function readAssetHref(manifestPath: string, key: AssetKey): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }

  const href = (parsed as Record<string, unknown>)[key];
  return typeof href === 'string' && href.startsWith('/assets/') ? href : undefined;
}

function missingManifestMessage(assetRoots: readonly string[]): string {
  return [
    '',
    '[agent-artifacts] ASSET BUILD MISSING',
    `  No ${MANIFEST_FILENAME} in: ${assetRoots.join(', ')}`,
    '  Pages are being served without their stylesheet and client scripts.',
    `  Fix: ${BUILD_COMMAND}   (pnpm dev, pnpm test and pnpm build already run it)`,
    '',
  ].join('\n');
}

function missingKeyMessage(key: AssetKey, manifestPath: string): string {
  return [
    '',
    '[agent-artifacts] ASSET MISSING FROM MANIFEST',
    `  ${manifestPath} has no usable "${key}" entry.`,
    '  Every page that references it is being rendered without it.',
    `  Fix: ${BUILD_COMMAND}   (scripts/build-assets.mjs writes every entry in one pass)`,
    '',
  ].join('\n');
}

function unservableMessage(
  key: AssetKey,
  href: string,
  servedRoot: string,
  manifestPath: string
): string {
  return [
    '',
    '[agent-artifacts] ASSET WILL 404',
    `  ${manifestPath} resolves "${key}" to ${href},`,
    `  but /assets/* is served from ${servedRoot}, which does not contain it.`,
    `  Working directory: ${process.cwd()}`,
    `  Fix: ${BUILD_COMMAND}, and start the app from the directory that contains public/.`,
    '',
  ].join('\n');
}
