import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { Sparkline, type SparklinePoint } from '../../src/ui/components/primitives.js';

function render(points: SparklinePoint[], size?: 'sm' | 'lg'): string {
  return renderToString(
    Sparkline({ id: 'probe', measure: 'Readers', points, ...(size ? { size } : {}) })
  );
}

function pathData(html: string): string[] {
  return Array.from(html.matchAll(/ d="([^"]+)"/g), (match) => String(match[1]));
}

/** The stroked line specifically — the area path is rendered first and would shadow it. */
function linePath(html: string): string {
  return String(/class="aa-sparkline__line" d="([^"]+)"/.exec(html)?.[1] ?? '');
}

/** Coordinates alternate x,y through every path command, so the odd positions are the y values. */
function yValues(d: string): number[] {
  return Array.from(d.matchAll(/-?\d+(?:\.\d+)?/g), (m) => Number(m[0])).filter(
    (_, index) => index % 2 === 1
  );
}

const series = (values: number[]): SparklinePoint[] =>
  values.map((value, index) => ({ label: `Point ${index + 1}`, value }));

/**
 * THE STATES THIS ACTUALLY LAUNCHES IN.
 *
 * Every account starts at zero and passes through one and two points on its way to a chart. Those
 * are not edge cases to be defended against — they are the first thing every new owner sees, and a
 * curve fitted through one reading is a fiction dressed as data. Each is asserted as a deliberate
 * rendering rather than merely "does not crash".
 */
describe('a sparkline with almost nothing to draw', () => {
  it('draws a resting baseline when there is no data at all', () => {
    const html = render([]);
    const paths = pathData(html);

    expect(paths).toHaveLength(1);
    // Flat, at the bottom, spanning the full width: an axis that exists and is empty.
    expect(paths[0]).toMatch(/^M 3 \d+(\.\d+)? L \d+(\.\d+)? \d+(\.\d+)?$/);
    // No area fill — there is no quantity to shade.
    expect(html).not.toContain('aa-sparkline__area');
    expect(html).toContain('No Readers recorded yet.');
  });

  it('draws a level and a marker for a single reading', () => {
    const html = render(series([4]));

    // A horizontal line, not a curve: one measurement is a level, and a slope would be invented.
    const line = linePath(html);
    expect(line).toMatch(/^M 3 [\d.]+ L [\d.]+ [\d.]+$/);
    expect(new Set(yValues(line)).size).toBe(1);
    expect(html).toContain('aa-sparkline__dot');
    expect(html).toContain('<title>Point 1: 4</title>');
  });

  it('draws two points as the straight segment they are', () => {
    const html = render(series([2, 9]));
    const line = linePath(html);

    // The Catmull-Rom conversion degenerates to a straight bezier here rather than overshooting,
    // which is why two points needs no special case in the geometry.
    expect(line).toContain('C');
    expect(line).not.toContain('NaN');
    expect(html).toContain('aa-sparkline__area');
  });

  it('rests a whole range of zeros on the baseline instead of filling the box', () => {
    const html = render(series([0, 0, 0, 0]));

    // Scaling zeros to fill the plot would draw a shape out of nothing at all.
    expect(html).not.toContain('aa-sparkline__area');
    expect(new Set(yValues(linePath(html))).size).toBe(1);
  });

  it('never emits NaN, at any length', () => {
    for (const length of [0, 1, 2, 3, 7, 24, 30]) {
      const html = render(series(Array.from({ length }, (_, index) => index % 5)));
      expect(html, `length ${length}`).not.toContain('NaN');
      expect(html, `length ${length}`).not.toContain('undefined');
    }
  });
});

describe('a sparkline that has data', () => {
  it('gives every bucket a hover target and a table row', () => {
    const html = render(series([1, 2, 3]));

    expect(html.match(/aa-sparkline__band/g) ?? []).toHaveLength(3);
    expect(html).toContain('<title>Point 2: 2</title>');
    // The table is the data view: readable, selectable, and announced — not trapped in a picture.
    expect(html).toContain('class="sr-only"');
    expect(html).toContain('<th scope="row">Point 3</th>');
  });

  it('summarises itself for a reader who cannot see it', () => {
    const html = render(series([5, 10]));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Readers: 15 across 2 points, peaking at 10."');
  });

  it('carries no script of any kind', () => {
    // The feature exists because counting could only see readers who ran our JavaScript. Presenting
    // its results in a chart that needs JavaScript would be a poor joke.
    expect(render(series([1, 2, 3]))).not.toMatch(/<script|onclick|onload/i);
  });
});
