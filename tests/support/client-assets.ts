import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Where the browser-side assets actually live now.
 *
 * These files used to exist only as hashed artefacts under `public/assets/`, so every test that
 * wanted to assert on their behaviour read build output as a fixture — which made build output the
 * de facto source of truth and meant editing viewer behaviour required hand-editing a file whose
 * name claimed to be a content hash. They are ordinary source files now; the hashed copies under
 * `public/assets/` are produced from them by `pnpm run build:assets`.
 *
 * Tests assert on the source. That the shipped artefact still equals it is asserted once, in
 * `tests/unit/client-assets-build.test.ts`.
 */
const CLIENT_SOURCES = {
  'ui-foundation.js': 'src/ui/client/ui-foundation.js',
  'viewer.js': 'src/ui/client/viewer.js',
  'dashboard.js': 'src/ui/client/dashboard.js',
  'viewer.css': 'src/ui/assets/viewer.css',
} as const;

export type ClientAssetKey = keyof typeof CLIENT_SOURCES;

const REPO_ROOT = new URL('../../', import.meta.url);

export function clientSourcePath(key: ClientAssetKey): string {
  return fileURLToPath(new URL(CLIENT_SOURCES[key], REPO_ROOT));
}

export function readClientSource(key: ClientAssetKey): string {
  return readFileSync(clientSourcePath(key), 'utf8');
}
