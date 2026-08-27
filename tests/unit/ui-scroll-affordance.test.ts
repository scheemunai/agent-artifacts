import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { MarketingApiBlock } from '../../src/ui/components/marketing.js';
import { CopyBlock } from '../../src/ui/components/primitives.js';

/**
 * A-14. Every surface in this product that scrolls its content sideways has to say so. The
 * marketing API block clipped its sample mid-token at 375 — `"content"` and then nothing — with no
 * fade, no scrollbar and no hint, while `CopyBlock` two components away already solved exactly
 * this and shipped the measurement to prove it.
 *
 * Held as one contract rather than two implementations: the class below is the mechanism, and any
 * scrollable code surface must carry all of it or none of it.
 */
const SCROLL_CONTRACT = [
  'data-aa-scroll-region="true"',
  'data-aa-scroll-hint-for',
  'aa-copy__hint',
];

const surfaces: Array<[string, string]> = [
  [
    'CopyBlock',
    renderToString(CopyBlock({ id: 'copy-specimen', label: 'Key', value: 'a-single-long-line' })),
  ],
  [
    'MarketingApiBlock',
    renderToString(
      MarketingApiBlock({ id: 'api-specimen', label: 'Publish', children: 'curl -X POST …' })
    ),
  ],
];

describe('scrollable code surfaces admit that they scroll', () => {
  it('gives every one of them the same affordance contract', () => {
    for (const [name, html] of surfaces) {
      for (const marker of SCROLL_CONTRACT) {
        expect(html, `${name} is missing ${marker}`).toContain(marker);
      }
    }
  });

  it('describes the block to assistive tech by the same hint it shows', () => {
    for (const [name, html] of surfaces) {
      const hintFor = /data-aa-scroll-hint-for="([^"]+)"/.exec(html)?.[1];
      const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1];

      expect(hintFor, `${name} wires no measured hint`).toBeDefined();
      expect(describedBy, `${name} announces no hint`).toBe(hintFor);
      expect(html, `${name} references a hint id it never renders`).toContain(`id="${hintFor}"`);
    }
  });

  it('leaves the hint hidden until something measures it', () => {
    // The server cannot know whether a block overflows: that depends on the viewport. Showing the
    // hint unconditionally would be a different lie from the one being fixed.
    const [, api] = surfaces[1] as [string, string];
    expect(api).toMatch(/<p[^>]*class="aa-copy__hint"[^>]*hidden/);
  });
});
