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

  it('keeps the full-screen CSS floor that short app-style HTML artifacts use', () => {
    const framed = parseStylesheet(viewerCss).filter(
      (rule) => rule.selector.includes('.aa-viewer-frame') && /min-height:/.test(rule.block)
    );

    expect(framed.length, 'no min-height rule found for the frame').toBeGreaterThan(0);
    expect(
      framed.some((rule) => rule.block.includes('min-height: calc(100dvh - 7rem)')),
      'HTML artifact frames should keep the viewport floor while measured heights may grow above it'
    ).toBe(true);
  });
});
