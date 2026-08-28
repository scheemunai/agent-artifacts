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
 * The public viewer is one body with two possible main regions and one footer:
 *
 *   body.aa-public-page > main.aa-viewer-document  + footer.aa-viewer-footer
 *   body.aa-public-page > main.aa-viewer-terminal  + footer.aa-viewer-footer
 *
 * The terminal main reserves the footer's strip — `min-height: calc(100vh - 4rem)` — so the footer
 * lands at the bottom of a short screen instead of floating under the content. The document main
 * carried `min-height: 0`, which in a block-flow body is inert, so a short artifact left the footer
 * hanging with roughly 540px of empty page beneath it at 1440.
 *
 * Both are the same screen in two states, so this holds them to one rule rather than to two values
 * that happen to match today. "Report abuse" is the only abuse affordance a public page has; where
 * it sits is not cosmetic.
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
  it('reserves the footer strip in every state of the screen, at every viewport', () => {
    for (const mainClass of SHELLS) {
      for (const viewportWidth of [375, 1440]) {
        const floor = winningDeclaration(
          documentRules,
          shell(mainClass),
          'min-height',
          viewportWidth
        );

        expect(floor?.value, `${mainClass} at ${viewportWidth}px sets no min-height`).toBeDefined();
        expect(
          floor?.value,
          `${mainClass} at ${viewportWidth}px does not reserve the footer strip`
        ).toContain('100vh');
      }
    }
  });

  it('pins the footer by one rule, not by two that agree today', () => {
    // The defect was asymmetry: the fix already existed on the terminal and had not been applied to
    // the document. Comparing the two values keeps them from drifting apart again.
    const values = SHELLS.map(
      (mainClass) => winningDeclaration(documentRules, shell(mainClass), 'min-height', 1440)?.value
    );

    expect(new Set(values).size, `viewer shells disagree: ${values.join(' vs ')}`).toBe(1);
  });
});
