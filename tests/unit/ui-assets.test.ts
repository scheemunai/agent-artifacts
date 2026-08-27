import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AssetKey,
  BUILD_MISSING_STYLESHEET_HREF,
  createAssetResolver,
} from '../../src/ui/assets.js';

const REPO_ROOT = new URL('../../', import.meta.url);
const repoPath = (relative: string): string => fileURLToPath(new URL(relative, REPO_ROOT));

let workspace: string;
let assetRoot: string;
let servedRoot: string;
let problems: string[];

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'aa-assets-'));
  assetRoot = join(workspace, 'public', 'assets');
  servedRoot = join(workspace, 'public');
  mkdirSync(assetRoot, { recursive: true });
  problems = [];
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function writeBuildOutput(entries: Record<string, string> = { 'app.css': '/assets/app-abcdef123456.css' }) {
  writeFileSync(join(assetRoot, 'manifest.json'), `${JSON.stringify(entries)}\n`);
  for (const href of Object.values(entries)) {
    writeFileSync(join(servedRoot, href.replace('/assets/', 'assets/')), '.aa-page{color:#2f3a40}');
  }
  return entries;
}

function resolver(overrides: { watchForRebuilds?: boolean; servedRoot?: string } = {}) {
  return createAssetResolver({
    assetRoots: [assetRoot],
    servedRoot: overrides.servedRoot ?? servedRoot,
    report: (message: string) => problems.push(message),
    watchForRebuilds: overrides.watchForRebuilds ?? false,
  });
}

describe('asset resolution', () => {
  it('resolves the manifest without depending on the working directory', () => {
    const { 'app.css': href } = writeBuildOutput();
    const elsewhere = mkdtempSync(join(tmpdir(), 'aa-cwd-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(elsewhere);
      expect(resolver()('app.css')).toBe(href);
    } finally {
      process.chdir(originalCwd);
      rmSync(elsewhere, { recursive: true, force: true });
    }

    expect(problems).toEqual([]);
  });

  it('reads the manifest once and serves the cached href afterwards', () => {
    const { 'app.css': href } = writeBuildOutput();
    const resolve = resolver();

    expect(resolve('app.css')).toBe(href);

    // Removing the manifest proves the second call never touched the filesystem again:
    // the pre-fix implementation read and parsed it on every single page render.
    rmSync(join(assetRoot, 'manifest.json'));

    expect(resolve('app.css')).toBe(href);
    expect(resolve('app.css')).toBe(href);
    expect(problems).toEqual([]);
  });

  it('returns nothing for an asset the build has not produced', () => {
    const resolve = resolver();

    // Never a hashed name the page cannot keep, and never an unhashed guess: pages omit what is
    // not there rather than emitting a reference that 404s.
    expect(resolve('viewer.js')).toBeUndefined();
    expect(resolve('app.css')).toBeUndefined();
    expect(existsSync(repoPath(`public${BUILD_MISSING_STYLESHEET_HREF}`))).toBe(true);
  });

  it('announces a missing build loudly, exactly once, with the command that fixes it', () => {
    const resolve = resolver();

    for (let call = 0; call < 5; call += 1) {
      expect(resolve('app.css')).toBeUndefined();
      expect(resolve('viewer.js')).toBeUndefined();
    }

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ASSET BUILD MISSING');
    expect(problems[0]).toContain('pnpm run build:assets');
    expect(problems[0]).toContain(assetRoot);
  });

  it('names the key when the manifest is missing just that entry', () => {
    writeBuildOutput();
    const resolve = resolver();

    expect(resolve('viewer.js')).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ASSET MISSING FROM MANIFEST');
    expect(problems[0]).toContain('viewer.js');
  });

  it('treats an unusable manifest as a missing build rather than a usable href', () => {
    writeFileSync(join(assetRoot, 'manifest.json'), '{ this is not json');
    expect(resolver()('app.css')).toBeUndefined();
    expect(problems[0]).toContain('ASSET MISSING FROM MANIFEST');

    problems = [];
    writeFileSync(join(assetRoot, 'manifest.json'), JSON.stringify({ 'app.css': 42 }));
    expect(resolver()('app.css')).toBeUndefined();
    expect(problems[0]).toContain('ASSET MISSING FROM MANIFEST');
  });

  it('picks an asset up as soon as the build lands, without a restart', () => {
    const resolve = resolver();
    expect(resolve('app.css')).toBeUndefined();

    const { 'app.css': href } = writeBuildOutput();

    expect(resolve('app.css')).toBe(href);
  });

  it('warns when a resolved asset is not reachable from the served root', () => {
    const { 'app.css': href } = writeBuildOutput();
    const emptyRoot = join(workspace, 'not-the-app-root');
    mkdirSync(emptyRoot, { recursive: true });

    expect(resolver({ servedRoot: emptyRoot })('app.css')).toBe(href);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ASSET WILL 404');
    expect(problems[0]).toContain(href);
    expect(problems[0]).toContain(process.cwd());
  });
});

/**
 * The producer of `manifest.json` is `scripts/build-assets.mjs`; the consumer is the resolver
 * above. Nothing else asserts that the two agree on the key names and the href shape, and a drift
 * there would strip the stylesheet and every client bundle while both halves look correct alone.
 *
 * This runs the real script over a copy of the real sources in a temporary tree. It deliberately
 * does NOT read the repository's own build output: a test that builds the artefact it is about to
 * assert on cannot fail, and an assertion that cannot fail is not evidence.
 */
describe('the real build script and the resolver', () => {
  const KEYS: AssetKey[] = ['app.css', 'ui-foundation.js', 'viewer.js', 'dashboard.js', 'viewer.css'];

  it('agree on every key the pages can ask for', () => {
    mkdirSync(join(workspace, '.scratch'), { recursive: true });
    writeFileSync(join(workspace, '.scratch/app.css'), '.aa-page{color:#2f3a40}');
    cpSync(repoPath('src/ui/client'), join(workspace, 'src/ui/client'), { recursive: true });
    mkdirSync(join(workspace, 'src/ui/assets'), { recursive: true });
    cpSync(repoPath('src/ui/assets/viewer.css'), join(workspace, 'src/ui/assets/viewer.css'));

    execFileSync(process.execPath, [repoPath('scripts/build-assets.mjs')], {
      cwd: workspace,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const resolve = resolver();
    for (const key of KEYS) {
      const href = resolve(key);
      expect(href, `manifest is missing "${key}"`).toBeDefined();
      expect(href).toMatch(/^\/assets\/[a-z-]+-[a-f0-9]{12}\.(js|css)$/);
      expect(existsSync(join(servedRoot, href as string))).toBe(true);
    }

    // One pass, one write: every key lands in the same manifest instead of the last writer
    // erasing the others.
    expect(problems).toEqual([]);
  });
});

describe('this repository', () => {
  it('keeps the fallback stylesheet checked in, so a clone can always serve it', () => {
    const path = `public${BUILD_MISSING_STYLESHEET_HREF}`;
    const tracked = execFileSync('git', ['ls-files', '--', path], {
      cwd: repoPath('.'),
      encoding: 'utf8',
    }).trim();

    expect(tracked).toBe(path);
  });
});
