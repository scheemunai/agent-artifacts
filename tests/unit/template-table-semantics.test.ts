import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (slug: string) =>
  readFileSync(new URL(`../../templates/${slug}.html`, import.meta.url), 'utf8');

// These four responsive tables intentionally retain explicit roles when CSS changes their display.
// Bound the exception to the known table inventory, rather than silencing future unrelated roles.
describe('responsive template table semantics', () => {
  it('uses four native scoped Postmortem row headers, not interactive roles on td', () => {
    const html = source('postmortem');
    expect(
      html.match(
        /<th class="a-id" scope="row" role="rowheader" data-mobile-label="ID">AI-[1-4]<\/th>/g
      )
    ).toHaveLength(4);
    expect(html).not.toMatch(/<td[^>]*role="rowheader"/);
  });

  for (const [slug, inventory, imageRoles] of [
    [
      'metrics-dashboard',
      { table: 1, rowgroup: 3, row: 7, columnheader: 5, rowheader: 6, cell: 24 },
      1,
    ],
    ['postmortem', { table: 1, rowgroup: 2, row: 5, columnheader: 5, rowheader: 4, cell: 16 }, 1],
    ['meeting-recap', { table: 1, rowgroup: 2, row: 7, columnheader: 4, cell: 24 }, 0],
    [
      'decision-brief',
      { table: 1, rowgroup: 2, row: 6, columnheader: 4, rowheader: 5, cell: 15 },
      0,
    ],
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
        Object.values(inventory).reduce((sum, count) => sum + count, 0) + imageRoles
      ); // The two operational examples also have one unchanged named SVG image.
    });
  }
});
