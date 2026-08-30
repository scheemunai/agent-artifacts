import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readClientSource } from '../support/client-assets.js';
import { parseStylesheet } from '../support/css-cascade.js';

/**
 * A-25: short content could not report its own height.
 *
 * The tall path was fixed in r3 — a 2400px fragment grows the frame — but a two-line fragment still
 * rendered a 432px box. Three floors, stacked, each individually reasonable:
 *
 *  1. The sender measured `documentElement.scrollHeight`. That is the initial containing block, and
 *     it can never report less than the frame's own viewport, so the CSS height became the smallest
 *     measurement the frame was capable of making. Its own default was the answer.
 *  2. The receiver clamped every measurement up to 288px.
 *  3. `.aa-viewer-frame` carried an unconditional `min-height`, which outranks the inline height the
 *     receiver sets even when the measurement is correct.
 *
 * Removing any one of them leaves the other two. The fix is to measure the *content* rather than the
 * viewport, and to let a floor apply only while nothing has been measured.
 *
 * WHAT THIS TEST SEES: the mechanism, not the pixel. The sender is a string executed on an opaque
 * sandbox origin inside a real browser, so its arithmetic can only be proven by a rendered frame —
 * that is the visual re-score's job, and it needs a short-fragment fixture to do it. What is
 * provable here is that no floor remains in a position to overrule a measurement.
 */

const frameDocument = readFileSync(
  fileURLToPath(new URL('../../src/ui/pages/frame-document.ts', import.meta.url)),
  'utf8'
);
const viewerJs = readClientSource('viewer.js');
const viewerCss = readFileSync(
  fileURLToPath(new URL('../../src/ui/assets/viewer.css', import.meta.url)),
  'utf8'
);

describe('the frame-height handshake', () => {
  it('measures the content, not the box the content was poured into', () => {
    const sender = /const FRAME_HEIGHT_SENDER = \[[\s\S]*?\]\.join\(''\);/.exec(frameDocument)?.[0];
    expect(sender, 'frame-height sender not found').toBeDefined();

    // The body's own box is the only thing in that document that can be shorter than the viewport.
    expect(
      sender,
      'the sender must consult the body, or the frame can never report less than its own height'
    ).toMatch(/document\.body/);
  });

  it('does not clamp a real measurement up to a default', () => {
    const floor = /const FRAME_MIN_HEIGHT = (\d+);/.exec(viewerJs)?.[1];
    expect(floor, 'FRAME_MIN_HEIGHT not found').toBeDefined();

    // A sanity floor against a broken or zero measurement is fine. A floor at the old default is
    // not: it silently discards every honest short answer.
    expect(Number(floor)).toBeLessThanOrEqual(96);
  });

  it('keeps the full-screen floor that short app-style HTML artifacts use', () => {
    // The floor is still there; it stopped being a number. `calc(100dvh - 7rem)` was a guess at the
    // combined height of the chrome and the footer — wrong whenever either changed, and wrong by a
    // whole footer on a branding-removed artifact, where it reserved a strip nothing occupied.
    // `flex-grow` asks for the same thing without naming either height.
    const framed = parseStylesheet(viewerCss).filter((rule) =>
      rule.selector.includes('.aa-viewer-frame')
    );

    expect(framed.length, 'no rule found for the frame').toBeGreaterThan(0);
    expect(
      framed.some((rule) => /flex:\s*1 0 auto/.test(rule.block)),
      'the frame should grow into the space the chrome and footer leave'
    ).toBe(true);
    // Declarations, not raw source: the reasoning above names the old value, and a comment
    // explaining a value is not the value.
    const declared = parseStylesheet(viewerCss).map((rule) => rule.block);
    expect(
      declared.some((block) => block.includes('100dvh - 7rem')),
      'the frame should not re-derive the chrome and footer heights as a literal'
    ).toBe(false);
  });

  it('lets a measured height grow the frame, and never shrink it', () => {
    // `flex-basis: auto` reads the inline height the handshake sets, and `flex-shrink: 0` keeps a
    // 3000px measurement at 3000px. A floor that could outrank a real measurement is the exact
    // defect A-25 was about, so it must not come back in flex form either.
    const framed = parseStylesheet(viewerCss).filter((rule) =>
      rule.selector.includes('.aa-viewer-frame')
    );

    for (const rule of framed) {
      expect(rule.block, 'an unconditional min-height would outrank the measurement').not.toMatch(
        /min-height:/
      );
    }
  });
});
