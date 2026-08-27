import { assetHref } from '../../src/ui/assets.js';

/**
 * Refuses to run the visual gate against an app whose assets have not been built.
 *
 * An unbuilt checkout still serves every page — with `build-missing.css`, which is a red banner
 * and no layout. A run against that state does not fail; it *reports*, and what it reports is
 * pages that look catastrophically broken. That is worse than a red build: it manufactures
 * findings against code that is fine, and someone has to spend an hour disproving them.
 *
 * This only asserts. It does not build — `pnpm run test:e2e` does that, in the runner, before
 * Playwright starts. A check that quietly fixed its own precondition would make the gate unable to
 * tell you the one thing it is here to say.
 */
export default function assertAssetsAreBuilt(): void {
  const stylesheet = assetHref('app.css');

  if (!stylesheet) {
    throw new Error(
      [
        '',
        'The hashed assets are not built, so every page would render unstyled and this run would',
        'report layout defects that do not exist.',
        '',
        '  Fix: pnpm run test:e2e   (builds the assets, then runs this suite)',
        '  Or:  pnpm run build:assets, then re-run playwright directly.',
        '',
      ].join('\n')
    );
  }
}
