import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { Table } from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import { readClientSource } from '../support/client-assets.js';
import {
  declarationValue,
  type ElementSpec,
  parseStylesheet,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * `.aa-table { min-width: 42rem }` inside `.aa-table-scroll { overflow-x: auto }` is a correct
 * scroll container with no affordance whatsoever: no fade, no resting scrollbar, no hint. So the
 * last column clipped mid-glyph at both viewports — "Up" for "Updated", "2h" for "2h ago", a
 * half-drawn "S" for "Share state" — and read as broken content rather than as a scroll region.
 * At 375 the entire Actions column of every dashboard table sat off-screen with nothing saying so.
 *
 * The scroll was never the bug. The silence was.
 */
const appCssSource = readFileSync('src/ui/assets/app.css', 'utf8');
const appRules = parseStylesheet(appCssSource);
const foundationScript = readClientSource('ui-foundation.js');

const table = () =>
  renderToString(
    Table({
      caption: 'Registered bots',
      columns: ['Name', 'Key', { label: 'Last used', priority: 'secondary' }, 'Actions'],
      rows: [['ops-bot', 'aa_bot_…x7Qk', '2h ago', 'Revoke']],
    })
  );

describe('Table scroll affordance', () => {
  it('names the scroll region it makes focusable', () => {
    // A `tabindex=0` element with no role and no accessible name is a tab stop that announces
    // nothing. The caption is right there.
    const html = table();

    // A named `<section>` is implicitly a region landmark, so no explicit role is needed.
    expect(html).toMatch(/<section class="aa-table-scroll[^"]*"/);
    expect(html).toContain('aria-label="Registered bots"');
    expect(html).toContain('tabindex="0"');
  });

  it('ships a hint that starts hidden and is described by the region', () => {
    const html = table();

    expect(html).toMatch(/data-aa-scroll-hint="true"[^>]*hidden|hidden[^>]*data-aa-scroll-hint/);
    expect(html).toContain('aria-describedby=');
    expect(html).toMatch(/Scroll[^<]*sideways|sideways[^<]*columns/i);
  });

  it('reveals the affordance from a real measurement, not an assumption', () => {
    // The CopyBlock hint is unconditional and therefore trains people to ignore hints. This one
    // appears only when the content genuinely does not fit.
    expect(foundationScript).toContain('data-aa-scroll-region');
    expect(foundationScript).toContain('scrollWidth');
    expect(foundationScript).toContain('clientWidth');
    // Rotating a phone or opening a drawer changes the answer.
    expect(foundationScript).toMatch(/ResizeObserver|'resize'/);
  });

  it('fades the clipped edge only while there is something past it', () => {
    const overflowing = appRules.find(
      (rule) => rule.selector === '.aa-table-scroll[data-aa-overflow="true"]'
    );
    expect(overflowing, 'no fade rule for an overflowing table').toBeDefined();
    expect(declarationValue(overflowing?.block ?? '', 'mask-image')).toBeDefined();

    const atEnd = appRules.find((rule) => rule.selector.includes('[data-aa-scroll-end="true"]'));
    expect(atEnd, 'the fade must lift once the last column is visible').toBeDefined();
    expect(declarationValue(atEnd?.block ?? '', 'mask-image')).toBe('none');

    // A table that fits must not be masked at all.
    const plain = appRules.find((rule) => rule.selector === '.aa-table-scroll');
    expect(declarationValue(plain?.block ?? '', 'mask-image')).toBeUndefined();
  });
});

describe('Table column priority', () => {
  it('marks secondary columns in both the head and the body', () => {
    const html = table();

    expect(html.match(/data-aa-priority="secondary"/g) ?? []).toHaveLength(2);
    expect(html).toContain('<th scope="col" data-aa-priority="secondary">Last used</th>');
  });

  it('documents a pattern that drops secondary columns on a phone and nowhere else', () => {
    const secondaryCell: ElementSpec[] = [
      { tag: 'section', classes: ['aa-table-scroll', 'aa-table-scroll--priority'] },
      { tag: 'table', classes: ['aa-table'] },
      { tag: 'tbody' },
      { tag: 'tr' },
      { tag: 'td', attributes: { 'data-aa-priority': 'secondary' } },
    ];

    expect(winningDeclaration(appRules, secondaryCell, 'display', 375)?.value).toBe('none');
    expect(winningDeclaration(appRules, secondaryCell, 'display', 1440)?.value).toBeUndefined();
  });

  it('is opt-in: an unmarked table keeps every column at every width', () => {
    const plainCell: ElementSpec[] = [
      { tag: 'section', classes: ['aa-table-scroll'] },
      { tag: 'table', classes: ['aa-table'] },
      { tag: 'tbody' },
      { tag: 'tr' },
      { tag: 'td', attributes: { 'data-aa-priority': 'secondary' } },
    ];

    expect(winningDeclaration(appRules, plainCell, 'display', 375)?.value).toBeUndefined();
  });

  it('is registered in the style guide', () => {
    const html = renderToString(StyleGuidePage());

    expect(html).toContain('aa-table-scroll--priority');
    expect(html).toContain('data-aa-priority="secondary"');
    expect(html).toContain('column priority');
  });
});
