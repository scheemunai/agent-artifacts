import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ElementSpec, parseStylesheet, winningDeclaration } from '../support/css-cascade.js';

/** The three rules PA-1 specced and the dashboard adopts. Values are this file's design call. */
const rules = parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8'));

const row: ElementSpec[] = [
  { tag: 'div', classes: ['aa-list'] },
  { tag: 'div', classes: ['aa-list-row'] },
];
const title: ElementSpec[] = [...row, { tag: 'span', classes: ['aa-list-row__title'] }];
const hoverTitle: ElementSpec[] = [
  { tag: 'div', classes: ['aa-list'] },
  { tag: 'div', classes: ['aa-list-row'], attributes: { 'data-aa-state': 'hover' } },
  { tag: 'span', classes: ['aa-list-row__title'] },
];

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

describe('list row', () => {
  it('borrows its columns from the list so rows align with each other', () => {
    // Independent per-row `auto` columns look aligned in a specimen and drift on real titles.
    expect(value(row, 'grid-template-columns')).toBe('subgrid');
    expect(value([row[0] as ElementSpec], 'grid-template-columns')).toContain('minmax(0, 1fr)');
  });

  it('spends accent on the row being pointed at, not on every row', () => {
    expect(value(title, 'color'), 'resting titles are coloured').toBe('var(--color-aa-ink)');
    expect(value(hoverTitle, 'color'), 'hover does not distinguish the row').toBe(
      'var(--color-aa-accent)'
    );
  });

  it('makes the whole row the target and the row the focus surface', () => {
    const link: ElementSpec[] = [...title, { tag: 'a', classes: ['aa-list-row__link'] }];

    expect(value(row, 'position'), 'the stretched link has nothing to stretch to').toBe('relative');
    expect(value(link, 'text-decoration')).toBe('none');
    // The ring belongs on the row: focus otherwise lands on a zero-size overlay.
    const focused: ElementSpec[] = [
      { tag: 'div', classes: ['aa-list'] },
      { tag: 'div', classes: ['aa-list-row'], attributes: { 'data-aa-state': 'focus' } },
    ];
    expect(value(focused, 'outline')).toContain('var(--color-aa-focus)');
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
