import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILD_MISSING_STYLESHEET_HREF, createStylesheetResolver } from '../../src/ui/assets.js';

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

function writeBuildOutput(href = '/assets/app-abcdef123456.css'): string {
  writeFileSync(join(assetRoot, 'manifest.json'), `${JSON.stringify({ 'app.css': href })}\n`);
  writeFileSync(join(servedRoot, href.replace('/assets/', 'assets/')), '.aa-page{color:#2f3a40}');
  return href;
}

function resolver(overrides: { watchForRebuilds?: boolean; servedRoot?: string } = {}) {
  return createStylesheetResolver({
    assetRoots: [assetRoot],
    servedRoot: overrides.servedRoot ?? servedRoot,
    report: (message) => problems.push(message),
    watchForRebuilds: overrides.watchForRebuilds ?? false,
  });
}

describe('stylesheet resolution', () => {
  it('resolves the manifest without depending on the working directory', () => {
    const href = writeBuildOutput();
    const elsewhere = mkdtempSync(join(tmpdir(), 'aa-cwd-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(elsewhere);
      expect(resolver()()).toBe(href);
    } finally {
      process.chdir(originalCwd);
      rmSync(elsewhere, { recursive: true, force: true });
    }

    expect(problems).toEqual([]);
  });

  it('reads the manifest once and serves the cached href afterwards', () => {
    const href = writeBuildOutput();
    const resolve = resolver();

    expect(resolve()).toBe(href);

    // Removing the manifest proves the second call never touched the filesystem again:
    // the pre-fix implementation read and parsed it on every single page render.
    rmSync(join(assetRoot, 'manifest.json'));

    expect(resolve()).toBe(href);
    expect(resolve()).toBe(href);
    expect(problems).toEqual([]);
  });

  it('never points a page at a stylesheet that does not exist', () => {
    const resolve = resolver();

    expect(resolve()).toBe(BUILD_MISSING_STYLESHEET_HREF);
    expect(resolve()).not.toBe('/assets/app.css');
    expect(existsSync(repoPath(`public${BUILD_MISSING_STYLESHEET_HREF}`))).toBe(true);
  });

  it('announces a missing build loudly, exactly once, with the command that fixes it', () => {
    const resolve = resolver();

    for (let call = 0; call < 5; call += 1) {
      expect(resolve()).toBe(BUILD_MISSING_STYLESHEET_HREF);
    }

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('STYLESHEET BUILD MISSING');
    expect(problems[0]).toContain('pnpm run build:css');
    expect(problems[0]).toContain(assetRoot);
  });

  it('treats an unusable manifest as a missing build rather than a usable href', () => {
    writeFileSync(join(assetRoot, 'manifest.json'), '{ this is not json');
    expect(resolver()()).toBe(BUILD_MISSING_STYLESHEET_HREF);
    expect(problems[0]).toContain('STYLESHEET MANIFEST UNREADABLE');

    problems = [];
    writeFileSync(join(assetRoot, 'manifest.json'), JSON.stringify({ 'app.css': 42 }));
    expect(resolver()()).toBe(BUILD_MISSING_STYLESHEET_HREF);
    expect(problems[0]).toContain('STYLESHEET MANIFEST UNREADABLE');
  });

  it('picks the stylesheet up as soon as the build lands, without a restart', () => {
    const resolve = resolver();
    expect(resolve()).toBe(BUILD_MISSING_STYLESHEET_HREF);

    const href = writeBuildOutput();

    expect(resolve()).toBe(href);
  });

  it('warns when the resolved stylesheet is not reachable from the served root', () => {
    const href = writeBuildOutput();
    const emptyRoot = join(workspace, 'not-the-app-root');
    mkdirSync(emptyRoot, { recursive: true });

    // Exactly the wrong-working-directory start: the manifest is found next to the code, but
    // `serveStatic({ root: './public' })` would answer 404 for the href it names.
    expect(resolver({ servedRoot: emptyRoot })()).toBe(href);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('STYLESHEET WILL 404');
    expect(problems[0]).toContain(href);
    expect(problems[0]).toContain(process.cwd());
  });
});

/**
 * The producer of `manifest.json` is `scripts/hash-css.mjs`; the consumer is the resolver above.
 * Nothing else asserts that the two agree on the key name and the href shape, and a drift there
 * would un-style every page while both halves look correct in isolation.
 *
 * This runs the real script into a temporary tree. It deliberately does NOT read the repository's
 * own build output: a test that builds the artefact it is about to assert on cannot fail, and an
 * assertion that cannot fail is not evidence. Whether *this* checkout happens to be built is
 * covered where it is a real user-visible claim rather than ambient state — an unbuilt clean
 * checkout in `tests/integration/fresh-clone-assets.test.ts`, a built one in
 * `tests/integration/image-layout-runtime.test.ts`.
 */
describe('the real build script and the resolver', () => {
  it('agree on the manifest key and the href shape', () => {
    const source = join(workspace, 'app.css');
    writeFileSync(source, '.aa-page{color:#2f3a40}');
    execFileSync(process.execPath, [repoPath('scripts/hash-css.mjs'), source], {
      cwd: workspace,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const href = resolver()();

    expect(href).toMatch(/^\/assets\/app-[a-f0-9]{12}\.css$/);
    expect(existsSync(join(servedRoot, href))).toBe(true);
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
