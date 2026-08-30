import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readClientSource } from '../support/client-assets.js';
import {
  type ElementSpec,
  nextOrder,
  parseStylesheet,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * The public viewer is one body with two possible main regions and an optional footer:
 *
 *   body.aa-public-page > main.aa-viewer-document  + footer.aa-viewer-footer?
 *   body.aa-public-page > main.aa-viewer-terminal  + footer.aa-viewer-footer?
 *
 * Each main has to take the leftover height so the footer lands at the bottom of a short screen
 * instead of floating under the content.
 *
 * IT USED TO BE ARITHMETIC, AND THE ARITHMETIC WAS WRONG TWICE. `min-height: calc(100vh - 4rem)`
 * hard-coded a footer strip while the HTML frame inside it sized against `100dvh` — and on a phone
 * those are different numbers, `vh` being the large viewport and `dvh` the current one. With the URL
 * bar showing, the main reserved ~80px more than its contents filled, and the difference rendered as
 * a band of white above the footer. The `4rem` was the second error: it is a guess about a footer
 * that is zero tall on a branding-removed artifact, where it left a bar with nothing in it.
 *
 * A flex column needs neither number. What this pins is that mechanism: both states grow, neither
 * shrinks, and they do it under ONE rule rather than two values that happen to agree today.
 */
const appRules = parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8'));
const documentRules = [
  ...appRules,
  ...parseStylesheet(readClientSource('viewer.css'), nextOrder(appRules)),
];

const body: ElementSpec = { tag: 'body', classes: ['aa-page', 'aa-public-page'] };

/** Both states of the same screen, named by the class their `<main>` carries. */
const SHELLS = ['aa-viewer-document', 'aa-viewer-terminal'] as const;

function shell(mainClass: string): ElementSpec[] {
  return [{ ...body }, { tag: 'main', classes: [mainClass] }];
}

describe('public viewer shell', () => {
  it('makes the page a column that can place a footer of any height, including none', () => {
    for (const viewportWidth of [375, 1440]) {
      const display = winningDeclaration(documentRules, [body], 'display', viewportWidth);
      const direction = winningDeclaration(documentRules, [body], 'flex-direction', viewportWidth);
      const floor = winningDeclaration(documentRules, [body], 'min-height', viewportWidth);

      expect(display?.value, `the page is not a flex container at ${viewportWidth}px`).toBe('flex');
      expect(direction?.value, `the page is not a column at ${viewportWidth}px`).toBe('column');
      // `dvh`, not `vh`: the unit mismatch between this floor and the frame's is what put a band of
      // white above the footer on a phone with its URL bar showing.
      expect(floor?.value, `the page floor at ${viewportWidth}px`).toBe('100dvh');
    }
  });

  it('grows every state of the screen into the leftover height, at every viewport', () => {
    for (const mainClass of SHELLS) {
      for (const viewportWidth of [375, 1440]) {
        const grow = winningDeclaration(documentRules, shell(mainClass), 'flex', viewportWidth);

        expect(grow?.value, `${mainClass} at ${viewportWidth}px sets no flex`).toBeDefined();
        // Grow into the space, never shrink below the content: a long artifact must overflow into
        // scroll rather than be squeezed to fit the viewport.
        expect(
          grow?.value,
          `${mainClass} at ${viewportWidth}px does not take the leftover height`
        ).toBe('1 0 auto');
      }
    }
  });

  it('pins the footer by one rule, not by two that agree today', () => {
    // The original defect was asymmetry: the fix existed on the terminal and had not been applied to
    // the document. Comparing the two values keeps them from drifting apart again.
    const values = SHELLS.map(
      (mainClass) => winningDeclaration(documentRules, shell(mainClass), 'flex', 1440)?.value
    );

    expect(new Set(values).size, `viewer shells disagree: ${values.join(' vs ')}`).toBe(1);
  });

  it('leaves no state of the screen reserving a footer strip that may not exist', () => {
    // The `4rem` allowance was a guess about another element's height. On a branding-removed
    // artifact there is no footer at all, and the allowance became an empty bar.
    // Declarations, not raw source: the reasoning at the top of the sheet names the old value, and
    // a comment explaining a value is not the value.
    const declared = parseStylesheet(readClientSource('viewer.css')).map((rule) => rule.block);

    expect(declared.filter((block) => block.includes('100vh - 4rem'))).toEqual([]);
  });
});
