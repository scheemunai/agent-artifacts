import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readClientSource } from '../support/client-assets.js';
import { parseStylesheet } from '../support/css-cascade.js';

/**
 * I-4's remainder: the scroll measurement reads both axes.
 *
 * It only read `scrollWidth`, so a region that scrolls vertically measured as "no overflow" and
 * had its hint hidden. The CopyBlock worked around that by proving the vertical case on the server
 * (`value.includes('\n')`) and withholding the hint from the measurement — two mechanisms for one
 * question. The fix was a single line, and it was blocked for the whole of round 1 because
 * `ui-foundation` was a frozen-hash artefact that could not be edited without lying about its
 * name. It is a source file now.
 */

const foundation = readClientSource('ui-foundation.js');
const appCss = readFileSync(
  fileURLToPath(new URL('../../src/ui/assets/app.css', import.meta.url)),
  'utf8'
);

const mechanism = /function updateScrollRegion[\s\S]*?\n}/.exec(foundation)?.[0] ?? '';

describe('the scroll measurement', () => {
  it('measures both axes', () => {
    expect(mechanism, 'scroll mechanism not found').not.toBe('');
    expect(mechanism).toContain('scrollWidth - region.clientWidth');
    expect(mechanism).toContain('scrollHeight - region.clientHeight');
  });

  it('reveals the hint from either axis', () => {
    expect(mechanism).toMatch(/hint\.hidden\s*=\s*!\(overflowingX \|\| overflowingY\)/);
  });

  it('keeps the edge fade horizontal, because that is what it means', () => {
    // `data-aa-overflow` and `data-aa-scroll-end` drive a sideways gradient; a vertical reading
    // there would paint a fade against an edge nothing scrolls past.
    expect(mechanism).toMatch(/setAttribute\('data-aa-overflow', overflowingX \? 'true' : 'false'\)/);
    expect(mechanism).toMatch(/overflowingX && atEnd/);
  });
});

describe('the constraint the second axis introduces', () => {
  it('keeps axis-worded hints on regions that cannot overflow the other way', () => {
    // The Table's hint says "sideways". Now that a vertical overflow can reveal a hint, that copy
    // would be a lie the moment `.aa-table-scroll` gained a max-height. Nothing stops someone
    // adding one except this.
    const bounded = parseStylesheet(appCss).filter(
      (rule) =>
        rule.selector.includes('.aa-table-scroll') &&
        /(^|;|\s)max-height\s*:/.test(rule.block)
    );

    expect(
      bounded.map((rule) => rule.selector),
      'a bounded .aa-table-scroll can scroll vertically, but its hint only mentions sideways'
    ).toEqual([]);
  });
});
