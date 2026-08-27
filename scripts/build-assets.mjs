/*
 * Builds every hashed runtime asset and writes the manifest that names them.
 *
 * One pass, one manifest write, deliberately. When the stylesheet and the client bundles were
 * produced by separate scripts, whichever ran last would overwrite `manifest.json` and silently
 * erase the other's entries — an app that renders unstyled or without its client behaviour, from a
 * build that reported success.
 *
 * The transform is copy-and-hash: output bytes equal input bytes. That is what lets
 * `tests/unit/client-assets-build.test.ts` assert reproducibility as exact equality, and it is why
 * nothing here minifies or bundles. If that ever changes, the guard has to change with it.
 *
 * Inputs are app-relative; the build always runs from the repository root.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const OUTPUT_DIR = 'public/assets';
const MANIFEST_FILE = 'manifest.json';

/**
 * Every hashed asset the app can ask for, keyed by the name pages use. Adding an entry here is the
 * only step needed to make a new client asset available through `assetHref()`.
 */
const ASSETS = [
  // Tailwind writes the stylesheet to .scratch first; `pnpm run build:assets` runs it before this.
  { key: 'app.css', source: '.scratch/app.css', name: 'app' },
  { key: 'ui-foundation.js', source: 'src/ui/client/ui-foundation.js', name: 'ui-foundation' },
  { key: 'viewer.js', source: 'src/ui/client/viewer.js', name: 'viewer' },
  { key: 'dashboard.js', source: 'src/ui/client/dashboard.js', name: 'dashboard' },
  { key: 'viewer.css', source: 'src/ui/assets/viewer.css', name: 'viewer' },
];

mkdirSync(OUTPUT_DIR, { recursive: true });

const manifest = {};
const built = new Set();

for (const asset of ASSETS) {
  const extension = extname(asset.source);
  const contents = readFileSync(asset.source);
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 12);
  const fileName = `${asset.name}-${hash}${extension}`;

  copyFileSync(asset.source, join(OUTPUT_DIR, fileName));
  manifest[asset.key] = `/assets/${fileName}`;
  built.add(fileName);
}

// Old hashes are dead weight and a source of confusion about which file is live; sweep every
// hashed name this build owns and did not just write.
const ownedPattern = new RegExp(
  `^(${ASSETS.map((asset) => asset.name).join('|')})-[a-f0-9]{12}\\.(js|css)$`
);
for (const file of readdirSync(OUTPUT_DIR)) {
  if (ownedPattern.test(file) && !built.has(file)) {
    rmSync(join(OUTPUT_DIR, file));
  }
}

writeFileSync(join(OUTPUT_DIR, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

for (const [key, href] of Object.entries(manifest)) {
  console.log(`${key.padEnd(18)} → ${href}`);
}
console.log(`Wrote ${join(OUTPUT_DIR, MANIFEST_FILE)} (${Object.keys(manifest).length} entries)`);
console.log(`Sources: ${ASSETS.map((asset) => basename(asset.source)).join(', ')}`);
