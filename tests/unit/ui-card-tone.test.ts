import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { Card } from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import {
  declarationValue,
  type ElementSpec,
  parseStylesheet,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * A destructive panel used to be built by hand wherever one was needed, which is how a tone
 * becomes a dialect: every author picks their own red. `tone="danger"` makes it one decision made
 * once, in the component, and the rules below pin the two things that are easy to get wrong when
 * tinting a surface that already has a border, a radius and a separator of its own.
 */
const cssSource = readFileSync('src/ui/assets/app.css', 'utf8');
const rules = parseStylesheet(cssSource);
const html = renderToString(StyleGuidePage());

function ruleFor(selector: string) {
  return rules.find((rule) => rule.selector === selector);
}

function block(selector: string): string {
  return ruleFor(selector)?.block ?? '';
}

const dangerCard: ElementSpec = { tag: 'section', classes: ['aa-card', 'aa-card--danger'] };
const header: ElementSpec = { tag: 'header', classes: ['aa-card__header'] };
const body: ElementSpec = { tag: 'div', classes: ['aa-card__body'] };

describe('card danger tone', () => {
  it('carries the tone as a prop rather than a class each caller remembers', () => {
    const plain = renderToString(Card({ title: 'Delete', children: 'body' }));
    const danger = renderToString(Card({ title: 'Delete', children: 'body', tone: 'danger' }));

    expect(plain, 'an untoned card is being reddened').not.toContain('aa-card--danger');
    expect(danger).toContain('aa-card--danger');
    // Still a card: the modifier is added to the base class, not swapped for it.
    expect(danger).toContain('aa-card');
  });

  it('reddens the border without losing to the base card rule', () => {
    expect(winningDeclaration(rules, [dangerCard], 'border-color', 1440)?.value).toBe(
      'var(--color-aa-danger-line)'
    );
    // `.aa-card` sets `border` as a shorthand and `.aa-card--danger` sets the longhand at equal
    // specificity, so source order is what makes the tone win. Pinned, because moving the block
    // above `.aa-card` would silently restore the grey border.
    const base = ruleFor('.aa-card')?.order ?? Number.POSITIVE_INFINITY;
    const tone = ruleFor('.aa-card--danger')?.order ?? -1;
    expect(tone, '.aa-card--danger is emitted before .aa-card and loses the tie').toBeGreaterThan(
      base
    );
  });

  it('stops the tint at the header, where the warning is', () => {
    expect(winningDeclaration(rules, [dangerCard, header], 'background', 1440)?.value).toBe(
      'var(--color-aa-danger-soft)'
    );
    // The body holds the thing being protected. Tinting it would make the contents read as the
    // warning about themselves.
    const bodyFill = winningDeclaration(rules, [dangerCard, body], 'background', 1440)?.value;
    expect(bodyFill ?? '', 'the danger tint has leaked into the card body').not.toContain('danger');
  });

  it('retones the separator the card already draws instead of stacking a second one', () => {
    // `.aa-card__header + .aa-card__body` draws that line on the body. A `border-bottom` on the
    // header would sit directly against it: two 1px rules, one red and one grey, which reads as a
    // rendering fault rather than as a tone.
    expect(
      declarationValue(block('.aa-card--danger .aa-card__header'), 'border-bottom'),
      'the danger header adds a second rule beside the separator the card already has'
    ).toBeUndefined();

    expect(
      declarationValue(
        block('.aa-card--danger .aa-card__header + .aa-card__body'),
        'border-top-color'
      ),
      'the separator below a danger header is still grey'
    ).toBe('var(--color-aa-danger-line)');
  });

  it('keeps the tint inside the corners the card is drawn with', () => {
    // A flat fill on the first child of a rounded, unclipped box paints square corners inside the
    // rounded ones. The card does not clip — on purpose, since clipping is a behaviour a tone
    // should not quietly introduce — so the header has to round its own top corners.
    expect(
      declarationValue(block('.aa-card'), 'overflow'),
      'the card now clips; this rule can go, but check what else it crops first'
    ).toBeUndefined();

    const radius = declarationValue(block('.aa-card--danger .aa-card__header'), 'border-radius');
    expect(radius, 'the danger header fills square corners inside a rounded card').toBeDefined();
    expect(radius).toMatch(/^\S.*\s0\s+0$/);
  });

  it('registers the tone in the design contract', () => {
    expect(html, 'the danger card has no specimen').toContain('aa-card--danger');
  });
});
