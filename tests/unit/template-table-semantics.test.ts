import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (slug: string) =>
  readFileSync(new URL(`../../templates/${slug}.html`, import.meta.url), 'utf8');

// These two responsive tables intentionally retain explicit roles when CSS changes their display.
// Bound the exception to the known table inventory, rather than silencing future unrelated roles.
describe('responsive operational table semantics', () => {
  it('uses four native scoped Postmortem row headers, not interactive roles on td', () => {
    const html = source('postmortem');
    expect(
      html.match(
        /<th class="a-id" scope="row" role="rowheader" data-mobile-label="ID">AI-[1-4]<\/th>/g
      )
    ).toHaveLength(4);
    expect(html).not.toMatch(/<td[^>]*role="rowheader"/);
  });

  for (const [slug, inventory] of [
    [
      'metrics-dashboard',
      { table: 1, rowgroup: 3, row: 7, columnheader: 5, rowheader: 6, cell: 24 },
    ],
    ['postmortem', { table: 1, rowgroup: 2, row: 5, columnheader: 5, rowheader: 4, cell: 16 }],
  ] as const) {
    it(`${slug} limits its compatibility exception to the documented role inventory`, () => {
      const html = source(slug);
      expect(html.match(/biome-ignore[^\n]*/g)).toEqual([
        'biome-ignore-all lint/a11y/noRedundantRoles: Explicit table roles retain semantics when mobile CSS uses block/grid display. -->',
      ]);
      const counts: Record<string, number> = {};
      for (const match of html.matchAll(
        /<(table|thead|tbody|tfoot|tr|th|td)\b[^>]*\brole="([^"]+)"/g
      )) {
        const role = match[2];
        if (!role) throw new Error('Missing explicit role capture');
        counts[role] = (counts[role] ?? 0) + 1;
      }
      expect(counts).toEqual(inventory);
      expect(html.match(/role="[^"]+"/g)).toHaveLength(
        Object.values(inventory).reduce((sum, count) => sum + count, 0) + 1
      ); // One unchanged named SVG image, outside the table.
    });
  }
});
