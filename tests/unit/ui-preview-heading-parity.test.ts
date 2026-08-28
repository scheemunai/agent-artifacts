import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ElementSpec, parseStylesheet, winningDeclaration } from '../support/css-cascade.js';

/**
 * B-P3's visual half, and the contract it leaves behind.
 *
 * The owner preview renders a document with `headingOffset: 1`, so the document's h1 arrives as an
 * h2, its h2 as an h3, and so on. That offset is deliberate — one h1 per page — and it is part of
 * the render-cache key precisely so the two contexts may differ safely. What was NOT deliberate is
 * that the type ramp stayed put: the document's top heading turned up wearing `.aa-md h2`'s 24px
 * rule, so a card whose whole promise is "this is what the reader sees" opened every document with
 * a horizontal line the reader never sees.
 *
 * The fix shifts the ramp by the same one level the structure shifted, so the pairing below is the
 * real invariant: for every document heading level, the tag the PREVIEW renders must be styled the
 * same as the tag the VIEWER renders. Fixing only the top heading would leave the document's real
 * h2s reading as h3s and the parity broken one level in — which is why this walks the levels
 * instead of asserting the one that was reported.
 *
 * Honest limit, stated because this file uses the resolver: it proves what the stylesheet DECIDES,
 * not what a reader sees. The live computed-style comparison that settled the border-style question
 * is in the commit message, not here — a browser is the only thing that can run it.
 */
const rules = parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8'));

const previewHeading = (tag: string): ElementSpec[] => [
  { tag: 'div', attributes: { 'data-aa-dashboard-preview': 'markdown' } },
  { tag: 'article', classes: ['aa-md'] },
  { tag },
];

const viewerHeading = (tag: string): ElementSpec[] => [
  { tag: 'main', classes: ['aa-viewer-content'] },
  { tag: 'article', classes: ['aa-md'] },
  { tag },
];

/** One level of the document's own hierarchy, and the tag each context renders it as. */
const LEVELS = [
  { document: 'h1', preview: 'h2', viewer: 'h1' },
  { document: 'h2', preview: 'h3', viewer: 'h2' },
  { document: 'h3', preview: 'h4', viewer: 'h3' },
  { document: 'h4', preview: 'h5', viewer: 'h4' },
] as const;

const resolve = (path: ElementSpec[], property: string) =>
  winningDeclaration(rules, path, property, 1440)?.value;

/**
 * A rule ends up with a visible bottom border, normalised across the two ways of saying "none":
 * an absent declaration, and an explicit zero width overriding an inherited one.
 */
function hasBottomRule(path: ElementSpec[]): boolean {
  const shorthand = resolve(path, 'border-bottom');
  const width = resolve(path, 'border-bottom-width');
  if (width !== undefined) {
    return !/^0/.test(width);
  }
  return shorthand !== undefined && !/^0/.test(shorthand);
}

describe('owner preview renders the document hierarchy the reader sees', () => {
  it('finds the rules it is meant to compare', () => {
    // Guards against the whole suite passing vacuously if the preview scope is ever renamed.
    const scoped = rules.filter((rule) => rule.selector.includes('data-aa-dashboard-preview'));
    expect(scoped.length, 'no preview-scoped heading rules found').toBeGreaterThan(3);
  });

  it('sizes every document heading the same in both contexts', () => {
    for (const level of LEVELS) {
      expect(
        resolve(previewHeading(level.preview), 'font-size'),
        `a document ${level.document} renders <${level.preview}> in the preview and ` +
          `<${level.viewer}> in the viewer; they must be the same size or the card is not a preview`
      ).toBe(resolve(viewerHeading(level.viewer), 'font-size'));
    }
  });

  it('spaces every document heading the same in both contexts', () => {
    // The assertion this file was missing, and the reason it passed over a real regression: it
    // checked size and border and never looked at margin, so the first version of the preview rules
    // shipped carrying `.aa-md h2`'s 2em section rhythm on the tag that renders the document TITLE.
    // The viewer's `.aa-md h1` is `0 0 0.6em` — nothing precedes a title, at any position — and the
    // preview must say the same thing. It did not, and at (0,2,1) it also outranked
    // `.aa-md > :first-child { margin-top: 0 }` at (0,2,0), so it defeated the four-line-older rule
    // written to stop preview cards opening with 2em of nothing and reopened that exact defect.
    //
    // Size, border AND spacing are what "the same heading" means; two out of three is how the
    // third one moves unwatched.
    for (const level of LEVELS) {
      expect(
        resolve(previewHeading(level.preview), 'margin'),
        `a document ${level.document} is spaced differently in the preview than in the viewer`
      ).toBe(resolve(viewerHeading(level.viewer), 'margin'));
    }
  });

  it('opens the document flush in the preview, without leaning on the positional rule', () => {
    // Stated limit, and the reason this is a separate assertion: the resolver strips positional
    // pseudo-classes, so `.aa-md > :first-child` reads to it as applying everywhere. That makes it
    // useless as a *witness* here — but it is also why the check that matters is the one below.
    // The preview's title rule must carry a zero top margin ON ITS OWN, so the flush lead survives
    // whether or not the positional rule wins.
    //
    // That is not belt-and-braces. `> :first-child` misses a document that opens with a paragraph
    // before its heading, and in the viewer such a heading is still flush because `.aa-md h1` has no
    // top margin at any position. Carrying the zero on the rule matches that in the preview too,
    // and closes the positional rule's gap rather than inheriting it.
    const margin = resolve(previewHeading('h2'), 'margin') ?? '';
    expect(
      /^0(?:\D|$)/.test(margin),
      `the preview title rule declares a top margin (${margin}), which both breaks parity with ` +
        'the viewer and, at (0,2,1), overrides the flush-lead rule at (0,2,0)'
    ).toBe(true);
  });

  it('draws the section rule at the same document level in both contexts', () => {
    for (const level of LEVELS) {
      expect(
        hasBottomRule(previewHeading(level.preview)),
        `the rule under a document ${level.document} differs between preview and viewer — this is ` +
          'the defect itself: the offset moved the tags and left the ramp behind'
      ).toBe(hasBottomRule(viewerHeading(level.viewer)));
    }
  });

  it('gives the document title no rule under it in either context', () => {
    // The reported symptom, kept as its own assertion so a regression names itself.
    expect(
      hasBottomRule(previewHeading('h2')),
      'the preview opens the document with a 24px rule'
    ).toBe(false);
    expect(hasBottomRule(viewerHeading('h1'))).toBe(false);
  });

  it('leaves the base ramp alone outside the preview', () => {
    // The scope is the whole safety of this change: prose in a dashboard card, the style guide, or
    // anywhere else must keep the unshifted treatment.
    const looseMarkdown: ElementSpec[] = [{ tag: 'article', classes: ['aa-md'] }, { tag: 'h2' }];
    expect(hasBottomRule(looseMarkdown), 'the shift leaked out of the preview').toBe(true);
    expect(resolve(looseMarkdown, 'font-size')).toBe('1.5rem');
  });
});
