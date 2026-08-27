import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState, Table } from '../../src/ui/components/primitives.js';
import { ShareTerminalMain } from '../../src/ui/components/share-terminal-main.js';

/**
 * An id that is unique only because there happens to be one instance is not unique — it is
 * undiscovered.
 *
 * The first attempt at generalising this was a duplicate-id sweep over the rendered style guide.
 * It passed, and the passing was the finding: the guide renders one `EmptyState` and gives both of
 * its `Table`s an explicit `id`, so it structurally cannot see the defect. A test written against
 * the surface the component author also wrote inherits that author's blind spots.
 *
 * The class is "ids that collide when the component is used twice on one page", so the test has to
 * use each component twice. Components that require an `id` from the caller are safe by
 * construction and are not listed; these are the ones that default or hard-code.
 */
const TWICE_USED: Array<{ name: string; render: (index: number) => string }> = [
  {
    // Two lists, both empty, is an ordinary page — the dashboard's templates page is exactly that.
    name: 'EmptyState',
    render: (index) =>
      renderToString(
        EmptyState({ title: `Nothing here ${index}`, description: `Try something ${index}.` })
      ),
  },
  {
    name: 'Table',
    render: (index) =>
      renderToString(
        Table({
          caption: `Registered bots ${index}`,
          columns: ['Name', 'Actions'],
          rows: [[`bot-${index}`, 'Revoke']],
        })
      ),
  },
  {
    name: 'ShareTerminalMain',
    render: (index) =>
      renderToString(
        ShareTerminalMain({
          title: `Gone ${index}`,
          message: `It went away ${index}.`,
          shareUrl: '/a/abc',
          status: 410,
        })
      ),
  },
];

function idsIn(html: string): string[] {
  return Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => String(match[1]));
}

describe('ids are unique by construction, not by there being only one', () => {
  for (const { name, render } of TWICE_USED) {
    it(`${name} keeps its ids distinct when a page uses it twice`, () => {
      const ids = [...idsIn(render(1)), ...idsIn(render(2))];
      const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

      expect(duplicates, `${name} repeats: ${duplicates.join(', ')}`).toEqual([]);
    });

    it(`${name} still points every aria reference at an id it rendered`, () => {
      // A derived id is only an improvement if the references move with it.
      const html = render(1);
      const rendered = new Set(idsIn(html));
      const referenced = Array.from(
        html.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/g),
        (match) => String(match[1])
      ).flatMap((value) => value.split(/\s+/));

      for (const reference of referenced) {
        expect(rendered.has(reference), `${name} references missing id "${reference}"`).toBe(true);
      }
    });
  }
});
