/*
 * Puts the bundled fonts where each consumer actually reads them.
 *
 * Two consumers, two destinations:
 *
 *  - The browser fetches the variable woff2 through `@font-face` in the stylesheet, so it belongs
 *    under the public asset root.
 *  - The Open Graph renderer (satori + resvg, `src/lib/og.ts`) parses raw TTF binaries from disk.
 *    Those have to travel with the compiled output, because the Docker image ships `dist/` and
 *    `public/` and never `src/`. Without this copy every `/a/:id/og.png` in a released image fails
 *    with "Missing bundled OG font" while working perfectly from a source checkout — which is
 *    exactly how it shipped.
 *
 * Paths are relative to the repository root; the build always runs this from there.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sourceDir = 'src/ui/assets/fonts';

const targets = [
  { dir: 'public/assets/fonts', files: ['source-sans-3-latin-var.woff2'] },
  {
    dir: 'dist/ui/assets/fonts',
    files: ['source-sans-3-latin-regular.ttf', 'source-sans-3-latin-semibold.ttf'],
  },
];

for (const target of targets) {
  mkdirSync(target.dir, { recursive: true });
  for (const file of target.files) {
    copyFileSync(join(sourceDir, file), join(target.dir, file));
  }
}
