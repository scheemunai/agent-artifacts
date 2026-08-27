import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStylesheet } from '../support/css-cascade.js';

/**
 * A-23: the chrome and the document have to be one grid.
 *
 * The viewer renders the artifact's title twice over — once in the sticky chrome, once as the
 * document's own heading — and at 1440 they sat 424px apart: the chrome full-bleed at x=32, the
 * prose column centred at x=456. Two grids for one page, and the eye reads the offset as a mistake
 * because it is one.
 *
 * The bar itself stays full-bleed; that is deliberate, and its border and blur are what make it read
 * as chrome rather than as content. What moves is its *contents*, onto the column of the thing they
 * describe.
 *
 * WHAT THIS TEST CAN AND CANNOT SEE, stated at the mechanism: it reads the declarations, not a
 * rendered page. `ch` depends on font metrics and `%` on the container, so no static reading can
 * produce the pixel the validator measured. What it can prove is derivation — that the chrome's
 * inset is computed from the same column token and the same edge inset as `.aa-prose-page`, so the
 * two cannot drift apart without this failing. The pixel itself is the visual re-score's job.
 */

const viewerCss = readFileSync(
  fileURLToPath(new URL('../../src/ui/assets/viewer.css', import.meta.url)),
  'utf8'
);
const appCss = readFileSync(
  fileURLToPath(new URL('../../src/ui/assets/app.css', import.meta.url)),
  'utf8'
);

function declarations(css: string, selector: string): string[] {
  return parseStylesheet(css)
    .filter((rule) => rule.selector.split(',').some((part) => part.trim() === selector))
    .map((rule) => rule.block);
}

describe('the viewer chrome and the document column', () => {
  it('are described by the same token, so they cannot drift apart', () => {
    const prose = declarations(appCss, '.aa-prose-page').join(' ');
    expect(prose, '.aa-prose-page not found in app.css').not.toBe('');

    // The column the document reads in. If app.css ever renames this, the assertions below fail
    // rather than silently comparing nothing.
    expect(prose).toContain('--width-aa-prose');
    expect(prose).toContain('--spacing-aa-6');

    const chrome = declarations(viewerCss, '.aa-viewer-chrome').join(' ');
    expect(chrome, '.aa-viewer-chrome not found in viewer.css').not.toBe('');

    // The chrome derives its inset from the document's column rather than choosing its own edge
    // padding: same token, same edge inset, one grid.
    expect(
      chrome,
      'the chrome must inset from --width-aa-prose, or its title floats off the column it titles'
    ).toContain('--width-aa-prose');
    expect(chrome).toContain('--spacing-aa-6');
  });

  it('keeps a floor so the narrow viewport does not lose its margins', () => {
    const chrome = declarations(viewerCss, '.aa-viewer-chrome').join(' ');

    // Below the column's own width the centring term goes negative; the floor is what keeps the
    // chrome padded on a phone instead of running to the bezel.
    expect(chrome).toMatch(/max\(/);
  });
});
