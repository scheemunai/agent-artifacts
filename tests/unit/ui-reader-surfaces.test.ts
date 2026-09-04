import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENTS, LegalPage } from '../../src/ui/pages/legal.js';
import { compiledAppRules } from '../support/compiled-stylesheet.js';
import {
  declarationValue,
  type ElementSpec,
  inheritedValue,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * The surfaces a reader receives, asserted against the sheet a reader receives.
 *
 * Every defect this file pins had the same shape and the same reason for surviving: the compiled
 * preflight neutralises a browser default, the scope that needed it never answered, and no test
 * could see the conflict because every stylesheet test in this suite reads Tailwind SOURCE — where
 * the preflight does not exist. `list-style`, `font-size`/`font-weight` on headings, `display` on
 * images and `text-decoration` on links are four lines of one file, and each of them cost a
 * reader something.
 *
 * So the rule this file exists to hold is narrow and testable: on a reader-facing surface, an
 * element must not end up wearing the reset.
 */
const rules = compiledAppRules();

function served(path: ElementSpec[], property: string, width = 1440): string | undefined {
  return winningDeclaration(rules, path, property, width)?.value;
}

/**
 * What the element actually ENDS UP WITH, walking inheritance down from the scope root.
 *
 * `served()` alone is not enough for the very defect this file exists for: the preflight's
 * `h1..h6 { font-size: inherit }` is a real declaration, so an unstyled heading answers "yes, a
 * font-size is set" and an assertion phrased that way passes over the bug. Resolving inheritance
 * turns `inherit` back into the paragraph value it actually resolves to, which is the number the
 * reader sees and the number that has to differ.
 */
/**
 * The last value a named selector declares for a property, read straight off the rule.
 *
 * Used where the cascade resolver cannot be trusted to pick the right winner: it strips
 * pseudo-elements, so `::-webkit-datetime-edit { display: inline-flex }` reads to it as a
 * zero-compound selector matching everything, and at equal specificity and later source order it
 * beats `img { display: block }`. That made the one assertion about images pass on a build where
 * images were broken. Where the question is "does this scope answer that reset", naming both rules
 * is the honest form of the question anyway.
 */
function declaredBy(selector: string, property: string): string | undefined {
  return rules
    .filter((rule) => rule.selector === selector)
    .map((rule) => declarationValue(rule.block, property))
    .filter((value): value is string => value !== undefined)
    .at(-1);
}

function effective(path: ElementSpec[], property: string, width = 1440): string | undefined {
  const own = served(path, property, width);
  if (own !== undefined && own !== 'inherit') {
    return own;
  }
  return inheritedValue(rules, path, property, width);
}

const article: ElementSpec[] = [{ tag: 'article', classes: ['aa-md'] }];
const body = (tag = 'p'): ElementSpec[] => [...article, { tag }];

describe('the artifact heading ladder has six distinguishable rungs', () => {
  // The defect: `.aa-md` restored h1–h4 and stopped, so `h1..h6 { font-size: inherit; font-weight:
  // inherit }` was the last word on the bottom two. Measured on the shipped page, an h5 and an h6
  // were 17px at weight 400 — the paragraph's own values — so `##### Heading` was not a heading and
  // a document silently flattened at its two deepest levels.
  const LEVELS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

  it("gives every level a size and a weight of its own, not the preflight's inherit", () => {
    for (const tag of LEVELS) {
      expect(served(body(tag), 'font-size'), `.aa-md ${tag} sets no font-size`).not.toBe('inherit');
      expect(served(body(tag), 'font-size'), `.aa-md ${tag} sets no font-size`).toBeDefined();
      expect(served(body(tag), 'font-weight'), `.aa-md ${tag} sets no font-weight`).not.toBe(
        'inherit'
      );
      expect(served(body(tag), 'font-weight'), `.aa-md ${tag} sets no font-weight`).toBeDefined();
    }
  });

  it('leaves no level looking like the paragraph beside it', () => {
    const paragraphSize = effective(body(), 'font-size');
    const paragraphWeight = effective(body(), 'font-weight') ?? '400';
    expect(paragraphSize, 'the paragraph baseline did not resolve').toBeDefined();

    for (const tag of LEVELS) {
      const sameSize = effective(body(tag), 'font-size') === paragraphSize;
      const sameWeight = (effective(body(tag), 'font-weight') ?? '400') === paragraphWeight;
      expect(
        sameSize && sameWeight,
        `.aa-md ${tag} renders at the paragraph's size AND weight, so it is not a heading`
      ).toBe(false);
    }
  });

  it('separates every rung from the one above it', () => {
    // Adjacent levels differing in nothing a reader can see is the same defect one step in.
    const fingerprint = (tag: string) =>
      [
        served(body(tag), 'font-size'),
        served(body(tag), 'font-weight'),
        served(body(tag), 'text-transform') ?? 'none',
        served(body(tag), 'color') ?? 'inherit',
      ].join('|');

    for (let index = 1; index < LEVELS.length; index += 1) {
      const above = LEVELS[index - 1] as string;
      const here = LEVELS[index] as string;
      expect(fingerprint(here), `.aa-md ${here} is indistinguishable from ${above}`).not.toBe(
        fingerprint(above)
      );
    }
  });
});

describe('the artifact scope answers every preflight reset it depends on', () => {
  it('keeps an inline image inline', () => {
    // `img { display: block }` in the preflight turned a row of three status badges into three
    // rows. Measured before the fix: tops 466 / 494 / 522 for images sharing a source line.
    expect(
      declaredBy('img', 'display'),
      'the preflight no longer sets img { display: block }, so this guard is stale'
    ).toBe('block');
    const scoped = declaredBy('.aa-md img', 'display');
    expect(scoped, '.aa-md img never answers the preflight display reset').toBeDefined();
    expect(scoped).not.toBe('block');
  });

  it('still lets an image that is its own paragraph behave like a figure', () => {
    // Selectors are compared with the whitespace around combinators removed: the served sheet is
    // minified, so `p > img` is written `p>img` there and `p > img` here.
    const tight = (value: string) => value.replace(/\s*([>+~])\s*/g, '$1');
    const loneImage = rules.find((rule) =>
      /\.aa-md p>img:only-child|\.aa-md figure>img/.test(tight(rule.selector))
    );
    expect(loneImage, 'a picture that is its own paragraph has no block treatment').toBeDefined();
    expect(declarationValue(loneImage?.block ?? '', 'display')).toBe('block');
  });

  it('gives a link a cue that is not colour', () => {
    // The accent is 2.36:1 against body ink; WCAG 1.4.1 asks for 3:1 before colour may be the only
    // distinguishing cue. The preflight had already removed the UA underline, and this scope only
    // restored it on hover — which is no help before pointing and none at all on a touch screen.
    // A LIVE link: `href` is part of the spec because `.aa-md a:not([href])` is a real rule and an
    // anchor without one genuinely matches it — the sanitizer strips the href of anything unsafe.
    const live: ElementSpec[] = [...article, { tag: 'a', attributes: { href: '/docs' } }];
    const decoration = served(live, 'text-decoration') ?? served(live, 'text-decoration-line');
    expect(decoration, '.aa-md a sets no text-decoration').toBeDefined();
    expect(decoration).toContain('underline');
  });

  it('does not dress a disarmed anchor as a live link, in any scope', () => {
    // With an underline added, the sanitizer's href-stripped anchor would otherwise wear the whole
    // costume. The rule used to be scoped to the viewer; colour alone made that arguable, an
    // underline does not.
    const disarmed: ElementSpec[] = [...article, { tag: 'a', attributes: {} }];
    const rule = rules.find(
      (candidate) =>
        candidate.selector.includes('.aa-md a:not([href])') &&
        !candidate.selector.includes(':hover')
    );
    expect(rule, 'no scope-independent rule for a disarmed anchor').toBeDefined();
    expect(rule?.block).toMatch(/text-decoration\s*:\s*none/);
    expect(disarmed).toBeDefined();
  });

  it('themes the highlight the sanitizer allows through', () => {
    // `mark` is on the allow list, so it arrives whether or not anything styles it, and unstyled it
    // is the UA's #ffff00 on black inside a Fresh Air document.
    const background = declaredBy('.aa-md mark', 'background');
    expect(background, '.aa-md mark takes the browser default yellow').toBeDefined();
    expect(background).toContain('var(--color-aa-');
  });

  it('indents a definition under its term', () => {
    expect(served([...article, { tag: 'dd' }], 'margin-inline-start')).toBeDefined();
    expect(served([...article, { tag: 'dt' }], 'font-weight')).toBeDefined();
  });

  it('makes a caption read as a caption', () => {
    const caption: ElementSpec[] = [...article, { tag: 'figure' }, { tag: 'figcaption' }];
    expect(served(caption, 'font-size')).not.toBe(served(body(), 'font-size'));
    expect(served(caption, 'color')).toBeDefined();
  });
});

describe('the legal pages are typeset as documents', () => {
  const heading: ElementSpec[] = [
    { tag: 'main', classes: ['aa-legal'] },
    { tag: 'article', classes: ['aa-legal__doc'] },
    { tag: 'section', classes: ['aa-legal__section'] },
    { tag: 'h2', classes: ['aa-legal__heading'] },
  ];
  const paragraph: ElementSpec[] = [...heading.slice(0, 3), { tag: 'p' }];
  const item: ElementSpec[] = [
    ...heading.slice(0, 3),
    { tag: 'ul', classes: ['aa-legal__list'] },
    { tag: 'li' },
  ];

  it('sizes a section heading above the paragraph under it', () => {
    // Fourteen headings on Terms and ten on Privacy rendered at 16px weight 400 — the paragraph's
    // own values — because `aa-legal__heading` was emitted and defined nowhere.
    expect(served(heading, 'font-size')).toBeDefined();
    expect(served(heading, 'font-size')).not.toBe(served(paragraph, 'font-size'));
    expect(served(heading, 'font-weight')).toBeDefined();
  });

  it('gives the legal lists their markers back', () => {
    // The Refund policy's four bullets and the Privacy policy's five. The artifact fix was scoped
    // to `.aa-md` and correctly does not reach here, so this scope answers the reset itself.
    expect(served(item.slice(0, -1), 'list-style-type')).toBe('disc');
  });

  it('holds the reading column', () => {
    expect(served(heading.slice(0, 2), 'width')).toContain('var(--width-aa-measure)');
  });

  it('underlines a link in a legal document', () => {
    const link: ElementSpec[] = [...heading.slice(0, 3), { tag: 'a', attributes: { href: '/x' } }];
    expect(served(link, 'text-decoration')).toContain('underline');
  });

  it('renders the classes it styles, on every legal document', () => {
    // The other half of the contract: a stylesheet that defines a scope the page does not emit is
    // the same defect wearing the other face.
    for (const [slug, document] of Object.entries(LEGAL_DOCUMENTS)) {
      const html = renderToString(LegalPage({ document: document as never }));
      expect(html, `${slug} renders no legal document column`).toContain('aa-legal__doc');
      expect(html, `${slug} renders no section wrapper`).toContain('aa-legal__section');
      if (html.includes('<ul')) {
        expect(html, `${slug} renders an unclassed list`).toContain('class="aa-legal__list"');
      }
      expect(html, `${slug} still hand-rolls its own header band`).not.toContain(
        'aa-marketing-header'
      );
    }
  });
});
