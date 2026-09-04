import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ElementSpec, parseStylesheet, winningDeclaration } from '../support/css-cascade.js';

/** The rules PA-1 specced and the dashboard adopts. Values are this file's design call.
 *
 * The list-row block that used to live here went with the component: `.aa-list*` was five classes
 * of CSS, a specimen in the style guide and two cascade tests, and no page in the product had ever
 * rendered it. A guard that now refuses to count the style guide as a consumer is what surfaced it.
 */
const rules = parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8'));

function value(element: ElementSpec[], property: string, width = 1440): string | undefined {
  return winningDeclaration(rules, element, property, width)?.value;
}

describe('the account block stands down on a phone', () => {
  it('is hidden by default and shown only from 760px', () => {
    const account: ElementSpec[] = [{ tag: 'div', classes: ['aa-app-nav__account'] }];

    expect(value(account, 'display', 375), 'the header shows identity on a phone').toBe('none');
    expect(value(account, 'display', 1440)).toBe('flex');
    expect(value(account, 'min-width', 1440), 'a long email cannot shrink the row').toBe('0');
  });
});

describe('danger card', () => {
  it('reddens the border and tints the header, and stops there', () => {
    const card: ElementSpec[] = [{ tag: 'section', classes: ['aa-card', 'aa-card--danger'] }];
    const header: ElementSpec[] = [...card, { tag: 'header', classes: ['aa-card__header'] }];
    const body: ElementSpec[] = [...card, { tag: 'div', classes: ['aa-card__body'] }];

    expect(value(card, 'border-color')).toBe('var(--color-aa-danger-line)');
    expect(value(header, 'background')).toBe('var(--color-aa-danger-soft)');
    // Tinting the body would make the contents read as the warning, when the contents are usually
    // the thing being protected. The body keeps whatever the base card gives it — the assertion is
    // that the danger tint does not reach it, not that the body is unstyled.
    expect(value(body, 'background'), 'the danger tint bled into the body').not.toBe(
      'var(--color-aa-danger-soft)'
    );
  });
});
