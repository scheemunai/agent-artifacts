import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The frozen-hash class, closed by construction.
 *
 * `ui-foundation-9ff54f825be4.js`, `viewer-0f4f9f6c8a7e.js` and `viewer-4fd0df5f2b2a.css` were
 * hand-edited under names that claimed to be content hashes. Every one of those hashes was false:
 * by the time this migration started, not a single filename matched its own bytes. A content hash
 * in a URL is a promise — *these bytes, at this address, forever* — and a returning visitor could
 * be served last month's script from cache with the app unable to tell.
 *
 * These assets are generated now, so the promise is kept by the generator rather than by anyone
 * remembering. This asserts that: the build writes every key in one manifest, each filename's hash
 * is its content's hash, and each artefact is byte-identical to the source it came from.
 */

const REPO_ROOT = new URL('../../', import.meta.url);
const repoPath = (relative: string): string => fileURLToPath(new URL(relative, REPO_ROOT));

/** Source → manifest key, the pairing `scripts/build-assets.mjs` implements. */
const SOURCES = {
  'app.css': '.scratch/app.css',
  'ui-foundation.js': 'src/ui/client/ui-foundation.js',
  'viewer.js': 'src/ui/client/viewer.js',
  'dashboard.js': 'src/ui/client/dashboard.js',
  'viewer.css': 'src/ui/assets/viewer.css',
} as const;

const HASHED_NAME = /^[a-z-]+-([a-f0-9]{12})\.(?:js|css)$/;

let build: string;
let manifest: Record<string, string>;

beforeAll(() => {
  build = mkdtempSync(join(tmpdir(), 'aa-asset-build-'));

  // A copy of the real sources, so the assertions are about the real files without the build
  // touching the repository's own output.
  mkdirSync(join(build, '.scratch'), { recursive: true });
  cpSync(repoPath('src/ui/assets/app.css'), join(build, '.scratch/app.css'));
  cpSync(repoPath('src/ui/client'), join(build, 'src/ui/client'), { recursive: true });
  mkdirSync(join(build, 'src/ui/assets'), { recursive: true });
  cpSync(repoPath('src/ui/assets/viewer.css'), join(build, 'src/ui/assets/viewer.css'));

  execFileSync(process.execPath, [repoPath('scripts/build-assets.mjs')], {
    cwd: build,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  manifest = JSON.parse(readFileSync(join(build, 'public/assets/manifest.json'), 'utf8'));
});

afterAll(() => {
  if (build) {
    rmSync(build, { recursive: true, force: true });
  }
});

describe('the hashed asset build', () => {
  it('writes every asset the pages can ask for into one manifest', () => {
    // One pass, one write. Two scripts writing this file in sequence would leave only the last
    // one's entries, and the app would come up missing whatever the loser produced.
    expect(Object.keys(manifest).toSorted()).toEqual(Object.keys(SOURCES).toSorted());
  });

  it.each(Object.keys(SOURCES))('gives %s a filename that is its own content hash', (key) => {
    const href = manifest[key];
    expect(href, `manifest is missing "${key}"`).toBeDefined();

    const fileName = basename(href as string);
    const claimed = HASHED_NAME.exec(fileName)?.[1];
    expect(claimed, `${fileName} is not a hashed name`).toBeDefined();

    const bytes = readFileSync(join(build, 'public/assets', fileName));
    const actual = createHash('sha256').update(bytes).digest('hex').slice(0, 12);

    expect(
      claimed,
      `${fileName} claims a hash its contents do not have — the exact defect this suite exists to prevent`
    ).toBe(actual);
  });

  it.each(Object.entries(SOURCES))(
    'ships %s byte-identical to %s',
    (key: string, source: string) => {
      const shipped = readFileSync(join(build, 'public/assets', basename(manifest[key] as string)));
      expect(shipped.equals(readFileSync(join(build, source)))).toBe(true);
    }
  );

  it('leaves no stale hashed files behind', () => {
    const live = new Set(Object.values(manifest).map((href) => basename(href)));
    const hashed = readdirSync(join(build, 'public/assets')).filter((file) =>
      HASHED_NAME.test(file)
    );

    expect(hashed.toSorted()).toEqual([...live].toSorted());
  });
});

describe('page source', () => {
  it('names no hashed asset anywhere', () => {
    // The literal that keeps coming back. Pages ask the manifest; if this fails, someone has
    // pasted a build artefact's name into source again and the freeze has restarted.
    const offenders = execFileSync(
      'bash',
      ['-c', String.raw`grep -rEn '/assets/[a-z-]+-[a-f0-9]{12}\.(js|css)' src/ || true`],
      { cwd: repoPath('.'), encoding: 'utf8' }
    ).trim();

    expect(offenders).toBe('');
  });
});
