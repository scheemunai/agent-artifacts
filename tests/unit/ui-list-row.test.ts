import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import {
  declarationValue,
  type ElementSpec,
  parseStylesheet,
  splitTopLevel,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * The list row is the shape every list of artifacts is made of, so its defects are not one page's
 * defects — they are the same defect once per list. Three of them are pinned here because each one
 * looks correct in a specimen and fails on real data:
 *
 *  - columns sized per row look aligned while every title is the same length, and drift the moment
 *    real titles differ;
 *  - a title in the accent colour looks deliberate on one row and leaves a list with no emphasis
 *    left for the row the reader is actually pointing at;
 *  - a stretched link makes the row clickable and moves focus onto a zero-size overlay, so the
 *    ring is drawn somewhere nobody can see it unless the row takes it over.
 *
 * Resolved through the cascade rather than matched as strings: what makes these correct is which
 * declaration wins on a real element, which a literal assertion cannot see.
 */
const cssSource = readFileSync('src/ui/assets/app.css', 'utf8');
const rules = parseStylesheet(cssSource);
const html = renderToString(StyleGuidePage());

/** Every rule whose selector list contains exactly this selector, in source order. */
function rulesFor(selector: string): typeof rules {
  return rules.filter((rule) =>
    rule.selector
      .split(',')
      .map((part) => part.trim())
      .includes(selector)
  );
}

function block(selector: string): string {
  return rulesFor(selector)[0]?.block ?? '';
}

const list: ElementSpec = { tag: 'div', classes: ['aa-list'] };
const row: ElementSpec = { tag: 'div', classes: ['aa-list-row'] };
const title: ElementSpec = { tag: 'span', classes: ['aa-list-row__title'] };

function rowInState(state: string): ElementSpec {
  return { ...row, attributes: { 'data-aa-state': state } };
}

describe('list row', () => {
  it('sizes its columns once for the list rather than once per row', () => {
    // `.aa-list` owns the tracks; each row borrows them. Per-row `auto` columns are the failure
    // this replaces: they agree with each other only while the content does.
    const listTracks = splitTopLevel(
      declarationValue(block('.aa-list'), 'grid-template-columns') ?? '',
      ' '
    );
    expect(listTracks).toHaveLength(3);

    expect(
      winningDeclaration(rules, [list, row], 'grid-template-columns', 1440)?.value,
      'the row does not borrow the list’s columns'
    ).toBe('subgrid');

    // The row must also span all of them, or `subgrid` has one track to borrow.
    expect(declarationValue(block('.aa-list-row'), 'grid-column')).toBe('1 / -1');
  });

  it('keeps a fallback that matches the list rather than collapsing to one column', () => {
    // `@supports` is transparent to the parser, so the unconditional rule is the fallback and the
    // `subgrid` one is the enhancement. A browser without subgrid gets rows that align whenever
    // their content is similar — not a single stacked column.
    const unconditional = rulesFor('.aa-list-row').filter((rule) => rule.media === null);
    const fallback = unconditional.find(
      (rule) => declarationValue(rule.block, 'grid-template-columns') !== 'subgrid'
    );
    const enhancement = unconditional.find(
      (rule) => declarationValue(rule.block, 'grid-template-columns') === 'subgrid'
    );

    expect(enhancement, 'the row never borrows the list’s columns').toBeDefined();
    expect(
      declarationValue(fallback?.block ?? '', 'grid-template-columns'),
      'the no-subgrid fallback does not declare the same tracks as the list'
    ).toBe(declarationValue(block('.aa-list'), 'grid-template-columns'));
    // Source order is what makes the enhancement apply: both are (0,1,0).
    expect(enhancement?.order).toBeGreaterThan(fallback?.order ?? Number.POSITIVE_INFINITY);
  });

  it('stops sharing one line at the width where the title stops fitting', () => {
    // The defect this pins was only visible at 375: the meta is `nowrap` and the badge is a pill,
    // so the two of them took the row and left the title roughly forty pixels, which
    // `overflow-wrap: anywhere` shredded a character at a time into a 127px-tall row. A specimen at
    // 1280 reported the pattern as working.
    expect(
      winningDeclaration(rules, [list, row], 'grid-template-columns', 375)?.value,
      'the row still borrows three columns on a phone'
    ).not.toBe('subgrid');

    expect(
      winningDeclaration(rules, [list, row, title], 'grid-column', 375)?.value,
      'the title does not get its own line on a phone'
    ).toBe('1 / -1');

    // And the alignment comes back once there is room for it.
    expect(winningDeclaration(rules, [list, row], 'grid-template-columns', 1440)?.value).toBe(
      'subgrid'
    );
    expect(
      winningDeclaration(rules, [list, row, title], 'grid-column', 1440)?.value,
      'the title is still stacked on a wide viewport'
    ).toBeUndefined();
  });

  it('spends accent on the row being pointed at, not on every title', () => {
    expect(
      winningDeclaration(rules, [list, row, title], 'color', 1440)?.value,
      'titles are coloured at rest, so a list has no emphasis left for the row under the cursor'
    ).toBe('var(--color-aa-ink)');

    for (const state of ['hover', 'focus']) {
      expect(
        winningDeclaration(rules, [list, rowInState(state), title], 'color', 1440)?.value,
        `a ${state} row does not lift its title`
      ).toBe('var(--color-aa-accent)');
    }
  });

  it('makes the whole row the target instead of the title’s text box', () => {
    // The overlay is absolutely positioned, so it covers the row only while the row is the nearest
    // positioned ancestor. Without this the hit area silently escapes to whatever is positioned
    // further up — usually the page — and the row stops being clickable where it looks clickable.
    expect(declarationValue(block('.aa-list-row'), 'position')).toBe('relative');

    const overlay = block('.aa-list-row__link::after');
    expect(overlay, 'the row has no stretched-link overlay').not.toBe('');
    expect(declarationValue(overlay, 'position')).toBe('absolute');
    expect(declarationValue(overlay, 'inset')).toBe('0');
  });

  it('draws the ring on the row, from the shared focus token, with no halo', () => {
    const focus = block('.aa-list-row:focus-within');
    expect(focus, 'the row does not take focus over from its overlay').not.toBe('');

    // Colour comes from the variable, so a retoned surface retones this ring for free — the whole
    // point of the token. A literal here would reintroduce the ring that ignores its surface.
    expect(declarationValue(focus, 'outline')).toContain('var(--color-aa-focus)');
    expect(focus, 'the row ring hardcodes a colour').not.toMatch(/#[0-9a-f]{3,8}\b/i);
    // Inset: rows are flush, so an outward ring would overlap its neighbour.
    expect(declarationValue(focus, 'outline-offset')).toBe('-2px');

    // The halo is off on both paths, and it has to be *stated* — `[data-aa-state="focus"]` also
    // matches the base focus rule, so leaving it unset would paint a glow in the style guide that
    // the live `:focus-within` path never draws, and spread it onto the row below.
    expect(
      winningDeclaration(rules, [list, rowInState('focus')], 'box-shadow', 1440)?.value,
      'the specimen row glows where the real one does not'
    ).toBe('none');

    // And the overlay keeps its own ring to itself, or the ring lands on a zero-size box.
    const overlayFocus = block('.aa-list-row__link:focus-visible');
    expect(declarationValue(overlayFocus, 'outline')).toBe('none');
    expect(declarationValue(overlayFocus, 'box-shadow')).toBe('none');
  });

  it('registers the row and both of its states in the design contract', () => {
    expect(html, 'the list row has no specimen').toContain('aa-list-row');
    for (const state of ['hover', 'focus']) {
      expect(html, `the guide documents no ${state} state for the list row`).toMatch(
        new RegExp(`aa-list-row"[^>]*data-aa-state="${state}"`)
      );
    }
  });
});
