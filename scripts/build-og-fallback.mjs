/*
 * Regenerates the checked-in Open Graph fallback card.
 *
 * `public/assets/og-fallback.png` is committed because it is served as a static file to unfurl
 * crawlers, but it is *derived*: `generateOgFallbackImage()` in `src/lib/og.ts` is the only
 * source of truth for it. `tests/unit/og-fallback-asset.test.ts` asserts the committed bytes
 * still equal that function's output, so any change to the palette, wordmark, mark geometry or
 * bundled font fails the suite until this script is re-run and the result committed.
 *
 * Usage: pnpm run build:og-fallback
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const { generateOgFallbackImage } = await import('../src/lib/og.ts');

const outputPath = fileURLToPath(new URL('../public/assets/og-fallback.png', import.meta.url));
const png = await generateOgFallbackImage();
const unchanged = existsSync(outputPath) && readFileSync(outputPath).equals(png);

writeFileSync(outputPath, png);
console.log(
  `${unchanged ? 'Unchanged' : 'Updated'} public/assets/og-fallback.png (${png.byteLength} bytes)`
);
