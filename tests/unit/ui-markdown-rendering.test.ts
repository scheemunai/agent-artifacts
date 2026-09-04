import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { renderMarkdownUncached } from '../../src/lib/markdown.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import { readClientSource } from '../support/client-assets.js';
import { compiledAppRules } from '../support/compiled-stylesheet.js';
import {
  type ElementSpec,
  parseStylesheet,
  specificity,
  winningDeclaration,
} from '../support/css-cascade.js';

const compiledRules = compiledAppRules();
const sourceRules = parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8'));
const foundationScript = readClientSource('ui-foundation.js');
const viewerScript = readClientSource('viewer.js');

const article: ElementSpec[] = [{ tag: 'article', classes: ['aa-md'] }];

function served(path: ElementSpec[], property: string, width = 1440): string | undefined {
  return winningDeclaration(compiledRules, path, property, width)?.value;
}

function outranks(a: [number, number, number], b: [number, number, number]): boolean {
  return a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
}

/**
 * The marker a browser actually paints, given that TWO properties are competing for it.
 *
 * `.aa-md` restores the LONGHAND — `list-style-type` — while the preflight resets the SHORTHAND.
 * That is deliberate and it is the part a future edit is most likely to undo: written as
 * `list-style: disc`, the minifier normalises it to `list-style: outside` (because `disc` is the
 * initial type) and the declaration stops naming the thing it exists to set. So the assertion is
 * not "a longhand exists" but "the longhand outranks the shorthand that would cancel it".
 */
function markerFor(path: ElementSpec[]): string | undefined {
  const longhand = winningDeclaration(compiledRules, path, 'list-style-type', 1440);
  if (!longhand) {
    return served(path, 'list-style');
  }
  const shorthand = winningDeclaration(compiledRules, path, 'list-style', 1440);
  if (
    shorthand &&
    outranks(specificity(shorthand.rule.selector), specificity(longhand.rule.selector))
  ) {
    return shorthand.value;
  }
  return longhand.value;
}

/** Markdown as an agent actually sends it: prose, three kinds of list, and two tables. */
const SAMPLE = `# Release notes

- first bullet
- second bullet
  - nested bullet
    - deeper still

1. first step
2. second step
   1. sub step
   2. another sub step

- [ ] unchecked task
- [x] checked task

| Region | Availability | Incidents |
| --- | ---: | ---: |
| us-east | 99.91% | 2 |
| eu-west | 99.97% | 0 |

| Key | Value |
| --- | --- |
| a | b |
`;

const rendered = renderMarkdownUncached(SAMPLE);

describe('markdown lists keep their markers in the stylesheet that ships', () => {
  it('gives an unordered list a bullet', () => {
    // Fails before the fix: the compiled preflight's `list-style: none` is the only rule that
    // matches, because `.aa-md` restored nothing.
    expect(markerFor([...article, { tag: 'ul' }])).toBe('disc');
  });

  it('gives an ordered list its numbers', () => {
    expect(markerFor([...article, { tag: 'ol' }])).toBe('decimal');
  });

  it('distinguishes the nested levels a document actually uses', () => {
    const nestedUl: ElementSpec[] = [...article, { tag: 'ul' }, { tag: 'li' }, { tag: 'ul' }];
    const deeperUl: ElementSpec[] = [...nestedUl, { tag: 'li' }, { tag: 'ul' }];
    const nestedOl: ElementSpec[] = [...article, { tag: 'ol' }, { tag: 'li' }, { tag: 'ol' }];

    expect(markerFor(nestedUl)).toBe('circle');
    expect(markerFor(deeperUl)).toBe('square');
    expect(markerFor(nestedOl)).toBe('lower-alpha');
  });

  it('leaves app chrome on the preflight reset it depends on', () => {
    // The reset is load-bearing everywhere else: nav rails, card lists, the dashboard's own lists
    // are all built on `list-style: none`. Restoring markers globally would have been the other
    // way to fix this, and it would have put a bullet on every one of them.
    expect(markerFor([{ tag: 'ul', classes: ['aa-list'] }])).toBe('none');
    expect(markerFor([{ tag: 'ol' }])).toBe('none');
  });

  it('marks a task list so its checkbox is the only marker it carries', () => {
    // `.aa-md .task-list-item` has been in the stylesheet all along. Nothing ever emitted it:
    // marked renders `<li><input type="checkbox"> …</li>` with no class, so the rule matched
    // nothing and the style guide's hand-written specimen was the only thing wearing it. Restoring
    // bullets without this puts a disc next to every checkbox.
    expect(rendered).toContain('class="task-list-item"');
    expect(rendered.match(/class="task-list-item"/g) ?? []).toHaveLength(2);

    const taskItem: ElementSpec[] = [
      ...article,
      { tag: 'ul' },
      { tag: 'li', classes: ['task-list-item'] },
    ];
    expect(markerFor(taskItem)).toBe('none');
  });

  it('does not mark a plain list item', () => {
    expect(rendered).toMatch(/<li>first bullet<\/li>/);
  });
});

describe('markdown tables scroll inside their own container', () => {
  it('wraps every table in the scroll region the stylesheet has always defined', () => {
    // `.aa-md-table-scroll` existed in the sheet and in the style guide. `renderMarkdown()` never
    // applied it, so the shipped fallback was `.aa-md table { display: block; width: 100% }` — a
    // bordered box stretched to the column with the cells still at content width, leaving a wide
    // empty band inside the border on the right of every markdown table in the product.
    expect(rendered.match(/class="aa-md-table-scroll"/g) ?? []).toHaveLength(2);
    expect(rendered.match(/<table>/g) ?? []).toHaveLength(2);
    expect(rendered).toMatch(/<section class="aa-md-table-scroll"[^>]*>\s*<table>/);
  });

  it('carries the whole scroll affordance contract, not part of it', () => {
    // Same contract `Table` and `CopyBlock` ship (`tests/unit/ui-scroll-affordance.test.ts`):
    // a region that is focusable, named, measured, and described by the hint it reveals.
    for (const marker of [
      'data-aa-scroll-region="true"',
      'data-aa-scroll-hint-for=',
      'tabindex="0"',
      'aria-label="Table"',
      'aria-describedby=',
    ]) {
      expect(rendered, `markdown tables are missing ${marker}`).toContain(marker);
    }

    const hintIds = Array.from(rendered.matchAll(/data-aa-scroll-hint-for="([^"]+)"/g), (match) =>
      String(match[1])
    );
    expect(hintIds).toHaveLength(2);
    expect(new Set(hintIds).size, 'two tables on one page share a hint id').toBe(2);

    for (const hintId of hintIds) {
      expect(rendered).toContain(`aria-describedby="${hintId}"`);
      expect(rendered).toMatch(new RegExp(`<p[^>]*id="${hintId}"[^>]*hidden`));
    }
  });

  it('leaves the hint hidden until something measures it', () => {
    // The server cannot know whether a table overflows — that depends on the viewport. An
    // always-on hint is the shape people learn to ignore.
    expect(rendered).toMatch(/data-aa-scroll-hint="true"/);
    expect(rendered).toMatch(/<p[^>]*class="aa-table__hint"[^>]*\shidden(?:="")?>/);
  });

  it('puts the hint outside the box that scrolls', () => {
    // Inside, the hint scrolls away with the content it is describing.
    expect(rendered).toMatch(/<\/table><\/section><p[^>]*aa-table__hint/);
  });

  it('does not wrap a table that is already inside one', () => {
    const nested = renderMarkdownUncached(
      '<table><tr><td><table><tr><td>inner</td></tr></table></td></tr></table>'
    );
    expect(nested.match(/aa-md-table-scroll/g) ?? []).toHaveLength(1);
  });

  it('hands the scrolling to the wrapper instead of to the table element', () => {
    const table: ElementSpec[] = [
      ...article,
      { tag: 'section', classes: ['aa-md-table-scroll'] },
      { tag: 'table' },
    ];
    const region: ElementSpec[] = [...article, { tag: 'section', classes: ['aa-md-table-scroll'] }];

    expect(served(region, 'overflow-x')).toBe('auto');
    // A table forced to `display: block` is what produced the stretched border box.
    expect(served(table, 'display')).not.toBe('block');
    expect(served(table, 'overflow-x')).toBeUndefined();
  });

  it('fills the container when it fits and keeps its own width when it does not', () => {
    const table: ElementSpec[] = [
      ...article,
      { tag: 'section', classes: ['aa-md-table-scroll'] },
      { tag: 'table' },
    ];

    // `width: max-content` with `min-width: 100%` is the pattern `.aa-md pre code` already uses:
    // a narrow table stretches to the column instead of sitting in a wider box, and a wide one
    // keeps its natural width and lets the wrapper scroll rather than squeezing every cell.
    expect(served(table, 'width')).toBe('max-content');
    expect(served(table, 'min-width')).toBe('100%');
  });

  it('never lets a table push the page wider than the viewport', () => {
    // The standing rule. A percentage or an intrinsic keyword resolves against the container, so
    // the only way a table can widen the page is a fixed `min-width` on it or on its wrapper.
    for (const selector of ['.aa-md table', '.aa-md .aa-md-table-scroll']) {
      for (const rule of sourceRules.filter((candidate) => candidate.selector === selector)) {
        const declared = /(?:^|;)\s*min-width\s*:([^;]+)/.exec(rule.block)?.[1]?.trim();
        if (!declared) {
          continue;
        }
        expect(
          /%|max-content|min-content|fit-content|auto|^0$/.test(declared),
          `${selector} sets min-width ${declared}, which can push the page sideways`
        ).toBe(true);
      }
    }
    expect(
      served([...article, { tag: 'section', classes: ['aa-md-table-scroll'] }], 'max-width')
    ).toBe('100%');
  });

  it('fades the clipped edge only while there is something past it', () => {
    // Same two-state mask `.aa-table-scroll` uses, driven by the same measurement.
    const overflowing = sourceRules.find(
      (rule) => rule.selector === '.aa-md .aa-md-table-scroll[data-aa-overflow="true"]'
    );
    expect(overflowing, 'no fade rule for an overflowing markdown table').toBeDefined();
    expect(overflowing?.block).toMatch(/mask-image:\s*linear-gradient/);

    const atEnd = sourceRules.find(
      (rule) =>
        rule.selector.includes('.aa-md-table-scroll') &&
        rule.selector.includes('[data-aa-scroll-end="true"]')
    );
    expect(atEnd, 'the fade must lift once the last column is visible').toBeDefined();
    expect(atEnd?.block).toMatch(/mask-image:\s*none/);
  });
});

describe('the measurement reaches content that arrives after load', () => {
  it('binds scroll regions inserted later, not only the ones present at bind time', () => {
    // The viewer replaces the whole prose column on every live update, so a markdown table that
    // arrived from a poll had a scroll container, a fade rule and a hint — and nothing measuring
    // any of them. `bindScrollRegions` collected `querySelectorAll` once and stopped.
    expect(foundationScript).toContain('MutationObserver');
    expect(viewerScript).toContain('aa-prose-page');
  });

  it('binds each region once however many times it is rescanned', () => {
    expect(foundationScript).toMatch(/WeakSet|dataset\.aaScrollBound|data-aa-scroll-bound/);
  });
});

describe('the style guide shows what the renderer emits', () => {
  const guide = renderToString(StyleGuidePage());

  it('specimens the wrapper with the same contract, not a lesser copy of it', () => {
    // The guide used to hand-write `<div class="aa-md-table-scroll" tabindex={0}>` — the scroll
    // container without the name, the measurement or the hint — beside an unwrapped table
    // captioned as proof that markdown tables scroll themselves. Both specimens described markup
    // `renderMarkdown()` has never produced, which is how the wrapper stayed unwired for so long:
    // the one place anybody would look to check said it was fine.
    for (const marker of [
      'class="aa-md-table-scroll"',
      'data-aa-scroll-region="true"',
      'data-aa-scroll-hint-for=',
      'aria-label="Table"',
      'class="aa-table-wrap"',
    ]) {
      expect(guide, `the markdown specimen is missing ${marker}`).toContain(marker);
    }
    expect(guide).not.toMatch(/<div class="aa-md-table-scroll" tabindex="0">/);
  });

  it('specimens both a table that fits and one that does not', () => {
    // The two cases behave differently and only one of them was ever shown. A narrow table must
    // fill its column without scrolling; a wide one must scroll without being squeezed.
    expect(guide).toContain('Wide table');
    expect(guide).toContain('Narrow table');
  });

  it('specimens the task-list class the renderer now emits', () => {
    expect(guide).toContain('class="task-list-item"');
    expect(rendered).toContain('class="task-list-item"');
  });
});
