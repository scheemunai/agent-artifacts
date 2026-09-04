import { existsSync, readFileSync } from 'node:fs';
import { expect } from 'vitest';
import { parseStylesheet, type StyleRule } from './css-cascade.js';

/**
 * THE BYTES THAT ARE SERVED, NOT THE BYTES THAT ARE WRITTEN.
 *
 * Every other stylesheet helper in this suite reads `src/ui/assets/app.css`, and that is why a
 * whole class of defect lived in this product without a single test going red.
 *
 * `app.css` is Tailwind *source*. The compiled sheet opens with a preflight the source never
 * mentions — `ol,ul,menu{list-style:none}`, `h1..h6{font-size:inherit;font-weight:inherit}`,
 * `img{display:block}`, `a{text-decoration:inherit}` — and a scope that fails to answer one of
 * those lines silently ships the reset. Measured on the shipped page before these were fixed: every
 * bullet list had no bullet, an `h5` was byte-identical to a paragraph, and three inline badges
 * rendered on three lines. A test reading the source can see none of it, because none of it is
 * there.
 *
 * Anything asserting what a READER receives resolves through here.
 */
export function compiledAppStylesheet(): string {
  const manifestPath = 'public/assets/manifest.json';
  expect(
    existsSync(manifestPath),
    'public/assets/manifest.json is missing — run `pnpm run build:assets` before this suite'
  ).toBe(true);

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;
  const href = manifest['app.css'];
  expect(href, 'the asset manifest names no compiled app.css').toBeDefined();

  const path = `public${href}`;
  expect(existsSync(path), `${href} is in the manifest but not on disk`).toBe(true);
  return readFileSync(path, 'utf8');
}

/** The compiled sheet, flattened into cascade-ordered rules. */
export function compiledAppRules(): StyleRule[] {
  return parseStylesheet(compiledAppStylesheet());
}
