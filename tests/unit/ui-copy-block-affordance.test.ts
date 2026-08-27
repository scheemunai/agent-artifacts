import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { CopyBlock } from '../../src/ui/components/primitives.js';
import { readClientSource } from '../support/client-assets.js';

/**
 * "Does this scroll?" had two answers in one product: the Table measured it, the CopyBlock sniffed
 * the value for a newline. The newline heuristic can only see the block axis — so a `credential`
 * block, which exists precisely to stop a long API key wrapping, overflowed *sideways* with no hint
 * and no `aria-describedby` at all. The variant's headline case was the one that lost its
 * affordance: A-17's "the scroll was never the bug, the silence was", one component over.
 *
 * The two answers are now one contract. The server states what it can prove (a multi-line value
 * overflows the block's max-height); everything else is measured through the same
 * `data-aa-scroll-region` attributes `ui-foundation` already implements — which needed no change to
 * serve a second component, because it never knew about the first.
 */
const foundation = readClientSource('ui-foundation.js');

/**
 * Long and single-line, which is all this test needs — and deliberately *not* shaped like a real
 * key. `release-check` flags anything matching `aa_bot_[A-Za-z0-9_-]{32,}`, and it cannot tell a
 * fabricated key from a live one. A repo that ships fixtures matching that pattern teaches people
 * to wave the alarm through, so the fixture changes rather than the scanner.
 */
const CREDENTIAL = 'example-credential-far-too-long-to-fit-inside-a-narrow-card-without-scrolling';
const PROMPT = 'POST /v1/artifacts\nAuthorization: Bearer [KEY]\n\n{ "title": "Weekly Ops" }';

describe('CopyBlock scroll affordance', () => {
  it('hands the unprovable case to the measurement, not to a guess', () => {
    // A single-line credential cannot overflow vertically, and whether it overflows horizontally
    // depends on the viewport — which the server cannot know.
    const html = renderToString(
      CopyBlock({ id: 'key', label: 'API key', value: CREDENTIAL, variant: 'credential' })
    );

    expect(html).toContain('data-aa-scroll-region="true"');
    expect(html).toContain('data-aa-scroll-hint-for="key-hint"');
    expect(html).toMatch(/<p class="aa-copy__hint" id="key-hint"[^>]*hidden/);
  });

  it('does not hand over the case the server has already settled', () => {
    // `updateScrollRegion` assigns `hint.hidden` unconditionally from a *horizontal* reading, so
    // wiring a hint the server has already shown would let a no-horizontal-overflow measurement
    // hide a block that genuinely scrolls vertically.
    const html = renderToString(CopyBlock({ id: 'prompt', label: 'Install', value: PROMPT }));

    expect(html).not.toContain('data-aa-scroll-hint-for');
    expect(html).toMatch(/<p class="aa-copy__hint" id="prompt-hint"(?![^>]*hidden)/);
    expect(html).toContain('Scroll inside the block');
  });

  it('never points aria-describedby at an element it did not render', () => {
    for (const [id, value] of [
      ['short', 'aa_bot_1'],
      ['long', CREDENTIAL],
      ['multi', PROMPT],
    ] as const) {
      const html = renderToString(CopyBlock({ id, label: 'Value', value }));
      const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];

      expect(described, `${id} lost its description`).toBeDefined();
      expect(html, `${id} dangles`).toContain(`id="${described}"`);
    }
  });

  it('reuses the shared mechanism rather than growing a second one', () => {
    // The contract is generic by construction, so adopting it for a second component needed no
    // change to a frozen-hash asset. Scoped to the mechanism: the file as a whole does name
    // components elsewhere (`data-aa-copy` is the copy button's own hook).
    const mechanism =
      /function updateScrollRegion[\s\S]*?\n}\n[\s\S]*?function bindScrollRegions[\s\S]*?\n}\n/.exec(
        foundation
      )?.[0];

    expect(mechanism, 'scroll mechanism not found').toBeDefined();
    expect(mechanism).toContain('data-aa-scroll-region');
    expect(mechanism).toContain('data-aa-scroll-hint-for');
    // No component names it: it works for any element that opts in through the attributes.
    expect(mechanism).not.toMatch(/aa-table|aa-copy|aa-md/);
  });
});
