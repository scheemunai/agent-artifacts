import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Two builds of one commit must produce one stylesheet.
 *
 * They did not. `.dockerignore` excludes `tests`, so the image's Tailwind scan never saw test files
 * while a local build did — and the local output carried eleven utilities and a `@property` that
 * the served CSS did not. Round 4's certificate had to disclose that gate 5 validated bytes which
 * were not the bytes being served. Nothing rendered differently, because the local build was a
 * strict superset; the problem is narrower and worse than a visual one. A gate cannot certify a
 * build it cannot reproduce, and "it only adds rules" is a claim that has to be re-established by
 * hand every time rather than being guaranteed.
 *
 * The cause is not that tests used utility classes. NO TEST EVER DID. Tailwind extracts candidate
 * class names from any text it reads, and a test suite about CSS is wall-to-wall CSS vocabulary:
 * `.sticky` came from the words "position: sticky" inside a comment, and `.w-full` came from
 * `expect(badge).not.toContain('w-full')` — an assertion that the class is ABSENT is what caused it
 * to be emitted. A scanner cannot tell discussion from use.
 *
 * So the scan is confined to `src/`, and this file pins both halves: the directive that does it,
 * and a consequence that holds independently of how it is done.
 */
const APP_CSS = 'src/ui/assets/app.css';
const source = readFileSync(APP_CSS, 'utf8');

const workspace = mkdtempSync(join(tmpdir(), 'aa-scan-scope-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** Every file under `src/` whose text the scanner could draw a class name from. */
function sourceCorpus(): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(tsx?|js|css|md)$/.test(entry.name)) {
        files.push(path);
      }
    }
  };
  walk('src');
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

function buildStylesheet(): string {
  const output = join(workspace, 'app.css');
  execFileSync('npx', ['tailwindcss', '-i', APP_CSS, '-o', output], { stdio: 'pipe' });
  return readFileSync(output, 'utf8');
}

describe('the stylesheet scan is confined to what ships', () => {
  it('disables automatic detection and points the scan at src', () => {
    // The mechanism. Automatic detection walks from the CSS file up to the git root, which is how
    // `tests/` got into a production stylesheet in the first place.
    expect(source, 'the bare import restores whole-repo scanning').not.toMatch(
      /@import\s+"tailwindcss"\s*;/
    );
    expect(source).toMatch(/@import\s+"tailwindcss"\s+source\(none\)\s*;/);

    const sources = [...source.matchAll(/@source\s+"([^"]+)"/g)].map((match) => String(match[1]));
    expect(sources, 'nothing tells the scanner where to look').not.toEqual([]);
    for (const path of sources) {
      // `../../` from `src/ui/assets/` is `src/`. Anything that climbs higher is the original bug.
      expect(
        path.startsWith('../../') && !path.startsWith('../../../'),
        `@source "${path}" reaches outside src/, which is where the divergence came from`
      ).toBe(true);
    }
  });

  it('emits no utility that exists nowhere in the code that ships', () => {
    // The consequence, asserted without reference to the mechanism above — if someone replaces the
    // directive with something else that works, this still passes; if they remove it, this fails
    // whatever the reason. `.row-0` and `.row-1` are what it caught when the scan was unconfined:
    // both came from assertion strings in an integration test.
    //
    // Stated limit, because it is weaker than the byte comparison that found this: a word that
    // appears in BOTH tests and src prose is invisible here. The strict version is "build twice,
    // once with tests present and once without, and diff" — which is what the certificate did by
    // hand. This is the part of that guarantee cheap enough to run on every commit.
    const corpus = sourceCorpus();
    const emitted = [
      ...new Set(
        [...buildStylesheet().matchAll(/^\s*\.([a-z][a-z0-9-]*)\s*\{/gm)].map((match) =>
          String(match[1])
        )
      ),
    ].filter((name) => !name.startsWith('aa-') && name !== 'sr-only');

    expect(emitted.length, 'no utilities parsed — the extraction stopped working').toBeGreaterThan(
      10
    );

    const orphans = emitted.filter((name) => !corpus.includes(name));
    expect(
      orphans,
      `the stylesheet ships ${orphans.join(', ')}, which appear nowhere under src/. Something ` +
        'outside the shipping code is feeding the scanner, so this build cannot be reproduced ' +
        'inside the image, where that something is not present.'
    ).toEqual([]);
  });
});
