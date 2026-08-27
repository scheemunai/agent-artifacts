import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateOgFallbackImage } from '../../src/lib/og.js';

const REPO_ROOT = new URL('../../', import.meta.url);
const repoPath = (relative: string): string => fileURLToPath(new URL(relative, REPO_ROOT));

const ASSET_PATH = 'public/assets/og-fallback.png';
const REGENERATE = 'pnpm run build:og-fallback';

/**
 * `public/assets/og-fallback.png` is committed because unfurl crawlers fetch it as a static file,
 * but it is derived from `generateOgFallbackImage()`. Without this guard the checked-in card can
 * drift from the pipeline that claims to produce it — which is exactly how it shipped in the
 * retired brand colours while `src/lib/og.ts` had already been repainted.
 */
describe('checked-in OG fallback card', () => {
  it('is byte-identical to what the OG pipeline renders today', async () => {
    const committed = readFileSync(repoPath(ASSET_PATH));
    const rendered = await generateOgFallbackImage();

    expect(
      rendered.equals(committed),
      `${ASSET_PATH} no longer matches generateOgFallbackImage(). Run \`${REGENERATE}\` and commit the result.`
    ).toBe(true);
  });

  it('renders reproducibly, so the guard cannot be flaky by construction', async () => {
    const first = await generateOgFallbackImage();
    const second = await generateOgFallbackImage();

    expect(second.equals(first)).toBe(true);
  });

  it('is tracked, and regenerating it is a documented one-command job', () => {
    const tracked = execFileSync('git', ['ls-files', '--', ASSET_PATH], {
      cwd: repoPath('.'),
      encoding: 'utf8',
    }).trim();
    expect(tracked).toBe(ASSET_PATH);

    const scripts = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')).scripts as Record<
      string,
      string
    >;
    expect(scripts['build:og-fallback']).toBe('tsx scripts/build-og-fallback.mjs');
    expect(readFileSync(repoPath('scripts/build-og-fallback.mjs'), 'utf8')).toContain(
      'generateOgFallbackImage'
    );
  });
});
