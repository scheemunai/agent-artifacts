import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStylesheet, resolveVars, themeVariables } from '../support/css-cascade.js';

/**
 * The app header is `position: sticky; top: 0`, so an in-page anchor scrolls its target to y=0 —
 * underneath the header. On the style guide, whose whole navigation is anchor links, every jump
 * landed with the heading and the first line of the section hidden behind the bar.
 *
 * The compensation is `scroll-padding-top` on the scroll container rather than `scroll-margin-top`
 * on each target: one declaration covers every anchor that exists now or later, instead of a list
 * of targets someone has to remember to extend.
 *
 * It is expressed in the same token the header's height is expressed in, so the two cannot drift.
 * That is the point of the test below — not the number, the agreement.
 */
const css = readFileSync('src/ui/assets/app.css', 'utf8');
const rules = parseStylesheet(css);
const theme = themeVariables(css);

function declaration(selector: string, property: string): string | undefined {
  const rule = rules.find((candidate) =>
    candidate.selector
      .split(',')
      .map((part) => part.trim())
      .includes(selector)
  );
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(rule?.block ?? '');
  return match?.[1]?.trim();
}

describe('anchor targets clear the sticky header', () => {
  it('offsets scrolling by exactly the header height, from one token', () => {
    const offset = declaration('html', 'scroll-padding-top');
    const headerHeight = declaration('.aa-app-nav', 'min-height');

    expect(offset, 'html declares no scroll-padding-top').toBeDefined();
    expect(headerHeight, '.aa-app-nav declares no min-height').toBeDefined();

    // Resolved through the theme, so the assertion holds whether they are written as the token or
    // as its value — what must not happen is the two disagreeing.
    const resolvedOffset = resolveVars(offset ?? '', theme);
    const resolvedHeader = resolveVars(headerHeight ?? '', theme);

    expect(resolvedOffset, 'the anchor offset is not a resolvable length').not.toContain('var(');
    expect(
      resolvedOffset,
      `anchor offset ${resolvedOffset} does not match header height ${resolvedHeader}`
    ).toBe(resolvedHeader);
  });

  it('states the header height once, as a token', () => {
    // A raw 4rem in either place is the drift this test exists to prevent: the header could grow
    // and the anchor offset would silently keep the old value.
    expect(theme.get('--height-aa-app-header'), 'no header-height token').toBeDefined();
    expect(declaration('html', 'scroll-padding-top')).toContain('--height-aa-app-header');
    expect(declaration('.aa-app-nav', 'min-height')).toContain('--height-aa-app-header');
  });
});
