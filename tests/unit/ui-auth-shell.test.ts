import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type ElementSpec,
  parseStylesheet,
  resolveVars,
  themeVariables,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * A-18. The auth screens are a single card centred on an otherwise empty page, and they were built
 * out of two widths that disagreed: `.aa-shell--narrow` at 46rem drew the card, while
 * `.aa-placeholder-card` capped every child at 30rem. The card spanned 686px and its contents
 * stopped 186px short of the right edge — a visibly left-heavy card with a column of white beside
 * every input.
 *
 * Second defect on the same screens: `.aa-placeholder` reserved `calc(100vh - 4rem)` for an app
 * header these pages do not render, so the card sat half that — 32px — above optical centre.
 *
 * One measure now drives the card, and the reservation is gone. The test asserts the agreement
 * rather than either number, because two tokens that happen to match are how this started.
 */
const css = readFileSync('src/ui/assets/app.css', 'utf8');
const rules = parseStylesheet(css);
const theme = themeVariables(css);

const shell: ElementSpec[] = [
  { tag: 'body', classes: ['aa-page'] },
  { tag: 'main', classes: ['aa-main', 'aa-placeholder'] },
  { tag: 'div', classes: ['aa-shell', 'aa-shell--narrow'] },
];
const cardContent: ElementSpec[] = [
  ...shell,
  { tag: 'section', classes: ['aa-card'] },
  { tag: 'div', classes: ['aa-stack', 'aa-placeholder-card'] },
];

function declaredWidth(element: ElementSpec[], viewportWidth: number): string {
  const declared = winningDeclaration(rules, element, 'width', viewportWidth)?.value;
  expect(declared, `no width resolved at ${viewportWidth}px`).toBeDefined();
  return resolveVars(declared ?? '', theme);
}

describe('auth and placeholder screens are one column, centred', () => {
  it('caps the column once, on the shell, and lets the contents fill it', () => {
    // Asserted structurally rather than in pixels on purpose: a percentage resolves against the
    // parent box, which a stylesheet-only resolver cannot model, and pretending otherwise would be
    // a test that computes a number nobody can act on. The invariant that actually matters is that
    // exactly one of these two boxes imposes a measure.
    for (const viewportWidth of [375, 1440]) {
      const outer = declaredWidth(shell, viewportWidth);
      const inner = declaredWidth(cardContent, viewportWidth);

      expect(outer, `the shell imposes no measure at ${viewportWidth}px`).toContain('30rem');
      expect(inner, `the content column caps itself independently: ${inner}`).toBe('100%');
    }

    // And the measure is stated once in the token layer, not twice.
    const widthTokens = [...theme.keys()].filter((name) => name.startsWith('--width-aa-'));
    const thirtyRem = widthTokens.filter((name) => theme.get(name)?.trim() === '30rem');
    expect(thirtyRem, `two tokens carry the same measure: ${thirtyRem.join(', ')}`).toHaveLength(1);
  });

  it('reserves no space for a header these pages do not render', () => {
    const floor = winningDeclaration(
      rules,
      [shell[0] as ElementSpec, shell[1] as ElementSpec],
      'min-height',
      1440
    );

    expect(floor?.value, '.aa-placeholder sets no min-height').toBeDefined();
    // The subtraction is the defect: it offsets the centred card by half the phantom header.
    expect(floor?.value, 'the phantom header reservation is still subtracted').not.toContain('-');
  });
});
