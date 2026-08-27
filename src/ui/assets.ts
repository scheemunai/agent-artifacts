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

/** Mirrors the static root `src/app.ts` serves `/assets/*` from. Both resolve from the install. */
const servedPublicRoot = (): string => appPath('public');

export interface StylesheetResolverOptions {
  /** Directories that may hold `manifest.json`, in priority order. */
  assetRoots: readonly string[];
  /** Directory the HTTP layer serves `/assets/*` from, used to detect hrefs that would 404. */
  servedRoot: string | (() => string);
  /** Receives one message per distinct problem, once per process. */
  report: (message: string) => void;
  /** Drop the cached href when the manifest is rewritten, so a dev rebuild is picked up. */
  watchForRebuilds?: boolean;
}

/**
 * Builds a `stylesheetHref()`. Exported so tests can point the resolver at a fixture tree and
 * assert the failure modes without touching the repository's real build output.
 */
export function createStylesheetResolver(options: StylesheetResolverOptions): () => string {
  const { assetRoots, servedRoot, report, watchForRebuilds = true } = options;
  const reported = new Set<string>();
  let cachedHref: string | undefined;
  let watcher: FSWatcher | undefined;

  const reportOnce = (key: string, message: string): void => {
    if (reported.has(key)) {
      return;
    }
    reported.add(key);
    report(message);
  };

  const watchManifest = (manifestPath: string): void => {
    if (watcher || !watchForRebuilds) {
      return;
    }

    try {
      watcher = watch(manifestPath, () => {
        cachedHref = undefined;
        watcher?.close();
        watcher = undefined;
      });
      // A stale stylesheet href is worth a watcher, never a process that will not exit.
      watcher.unref();
    } catch {
      // Watching is a development convenience. Platforms without inotify keep the cached href.
    }
  };

  return function stylesheetHref(): string {
    if (cachedHref) {
      return cachedHref;
    }

    const manifestPath = assetRoots
      .map((root) => join(root, MANIFEST_FILENAME))
      .find((candidate) => existsSync(candidate));

    if (!manifestPath) {
      reportOnce('missing-manifest', missingManifestMessage(assetRoots));
      // Deliberately not cached: the next render picks the stylesheet up once the build lands.
      return BUILD_MISSING_STYLESHEET_HREF;
    }

    const href = readStylesheetHref(manifestPath);
    if (!href) {
      reportOnce('unreadable-manifest', unreadableManifestMessage(manifestPath));
      return BUILD_MISSING_STYLESHEET_HREF;
    }

    const served = typeof servedRoot === 'function' ? servedRoot() : servedRoot;
    if (!existsSync(join(served, href))) {
      reportOnce('unservable-stylesheet', unservableMessage(href, served, manifestPath));
    }

    watchManifest(manifestPath);
    cachedHref = href;
    return href;
  };
}

/**
 * The href every page puts in `<link rel="stylesheet">`. Reads `manifest.json` at most once per
 * process (until a rebuild rewrites it) instead of on every render.
 */
export const stylesheetHref: () => string = createStylesheetResolver({
  assetRoots: shippedPathCandidates('public/assets'),
  servedRoot: servedPublicRoot,
  report: (message) => {
    process.stderr.write(`${message}\n`);
  },
});

function readStylesheetHref(manifestPath: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }

  const href = (parsed as Record<string, unknown>)[STYLESHEET_KEY];
  return typeof href === 'string' && href.startsWith('/assets/') ? href : undefined;
}

function missingManifestMessage(assetRoots: readonly string[]): string {
  return [
    '',
    '[agent-artifacts] STYLESHEET BUILD MISSING',
    `  No ${MANIFEST_FILENAME} in: ${assetRoots.join(', ')}`,
    '  Every page is being served with the fallback notice stylesheet and will look unstyled.',
    '  Fix: pnpm run build:css   (pnpm dev and pnpm build already run it)',
    '',
  ].join('\n');
}

function unreadableManifestMessage(manifestPath: string): string {
  return [
    '',
    '[agent-artifacts] STYLESHEET MANIFEST UNREADABLE',
    `  ${manifestPath} exists but has no usable "${STYLESHEET_KEY}" entry.`,
    '  Every page is being served with the fallback notice stylesheet and will look unstyled.',
    '  Fix: pnpm run build:css   (rewrites the manifest from src/ui/assets/app.css)',
    '',
  ].join('\n');
}

function unservableMessage(href: string, servedRoot: string, manifestPath: string): string {
  return [
    '',
    '[agent-artifacts] STYLESHEET WILL 404',
    `  ${manifestPath} resolves the stylesheet to ${href},`,
    `  but /assets/* is served from ${servedRoot}, which does not contain it.`,
    `  Working directory: ${process.cwd()}`,
    '  Fix: start the app from the directory that contains public/ (the repo root, or /app in Docker).',
    '',
  ].join('\n');
}
