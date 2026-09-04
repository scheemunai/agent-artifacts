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

    // A BORDER BOX, NOT A SCROLL HEIGHT. `scrollHeight` is floored at the frame's own viewport, so
    // a document can never use it to report that it is shorter than the box it was poured into —
    // that was A-25, and it is why this assertion exists at all. The root element's border box is
    // not floored: measured on a two-line document, it reads 114 while `scrollHeight` reads 802 at
    // 1440 and 714 at 375.
    expect(
      sender,
      'the sender must measure a border box, or the frame can never report less than its own height'
    ).toMatch(/getBoundingClientRect\(\)\.height/);
  });

  it('compares its measurement against nothing the embedder controls', () => {
    const sender =
      /const FRAME_HEIGHT_SENDER = \[[\s\S]*?\]\.join\(''\);/.exec(frameDocument)?.[0] ?? '';

    // The frame's current height is this script's own last answer. A measurement that reads it and
    // decides from it is a feedback loop, and it behaved like one: an intermediate version of this
    // fix compared the body's box against `clientHeight` and oscillated 4130 → 4114 → 4130 on any
    // document ending in a paragraph, because a trailing margin collapses out of one and not the
    // other. One unfloored measurement leaves nothing to compare.
    expect(sender, 'the sender reads the box the embedder sized').not.toMatch(/clientHeight/);
    expect(sender).not.toMatch(/innerHeight/);
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

  it('reaches a whole document, which is what every HTML template publishes', () => {
    // The gap that let this ship: the sender was added by the shell that WRAPS a fragment, and a
    // full document is not wrapped. All three built-in HTML templates are full documents, and the
    // template flow asks an agent to rehash one — so the artifacts most likely to be long were
    // exactly the ones that could not report a length.
    expect(frameDocument).toMatch(
      /isFullHtmlDocument\(content\)\s*\)\s*{\s*return `\$\{content\}<script>\$\{FRAME_HEIGHT_SENDER\}<\/script>`/
    );
  });

  it('caps the measurement high enough that real documents never meet it', () => {
    const ceiling = Number(
      /const FRAME_MAX_HEIGHT = ([\d_]+);/.exec(viewerJs)?.[1]?.replace(/_/g, '')
    );
    expect(ceiling, 'FRAME_MAX_HEIGHT not found').toBeGreaterThan(0);

    // The cap is a circuit breaker against a broken or hostile measurement, not a limit on how long
    // a document may be. At 2400 it was doing the second job too: the shipped `report-html`
    // measures 3344px at 1440 and 4972px at 390, and both were clamped into a nested scrollbar. A
    // ceiling that fires on this product's own output is not protecting anyone.
    expect(ceiling, 'the cap fires on ordinary product output').toBeGreaterThan(6000);
    // And it still has to be a ceiling. An unbounded number is laid out in the reader's browser.
    expect(ceiling).toBeLessThanOrEqual(40_000);
  });

  it('still clamps rather than trusts, so an absurd measurement cannot run away', () => {
    expect(viewerJs).toMatch(/Math\.min\(\s*Math\.max\([\s\S]*?FRAME_MAX_HEIGHT/);
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
