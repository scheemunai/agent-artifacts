import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { HomePage } from '../../src/ui/pages/home.js';
import {
  type ElementSpec,
  inheritedValue,
  parseStylesheet,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * A-36 has now been half-applied twice.
 *
 * The first pass left-aligned the origin quote and left the pricing sentence centred, on the
 * argument that the price was "a short display line". Measured, it was six centred lines at 375 and
 * four at 1440 — there was no width at which the premise held. A list of the blocks somebody
 * remembered would have gone on missing it, so this WALKS what the page actually renders.
 *
 * The rule being enforced: centring is for a line the eye takes in at once. Running prose set centre
 * takes the left edge away from the reader, who then has to hunt for the start of every line.
 *
 * Length is a PROXY for line count, and stating that is the honest part: this file resolves the
 * cascade, and the cascade does not know how text wraps. A block over the threshold is therefore not
 * a defect — it is a QUESTION, and the answer has to be written down next to it. `.aa-marketing-works`
 * is 99 characters and centred and perfectly correct, because it is a list of agent names rather than
 * a sentence. That distinction cannot be computed here, so it is argued here.
 */
const rules = parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8'));
const html = renderToString(
  HomePage({ baseUrl: 'https://agentartifact.ai', githubUrl: 'https://github.com/example/aa' }) as
    // biome-ignore lint/suspicious/noExplicitAny: the page's own props type is not exported for tests
    any
);

/**
 * Above this many characters a block will wrap on a phone, so centring it is a claim that needs
 * defending. Chosen from the rendered page rather than taste: the shortest block anyone has argued
 * for is 65 characters, and the defect that prompted this file was 129.
 */
const WRAPS_ON_A_PHONE = 60;

/** Centred blocks longer than the threshold, each with the reason it is not running prose. */
const CENTRED_BY_ARGUMENT: Record<string, string> = {
  'aa-marketing-works':
    'a list of agent names, not a sentence — 3 lines at 375 and 2 at desktop, each line whole items',
  'aa-marketing-api__caption':
    'two lines at every measured width, 375 through 1440 — a caption taken in at once, not prose',
};

interface TextBlock {
  classes: string[];
  length: number;
  text: string;
  /** The real ancestor chain, root-first, ending with the block itself. */
  path: ElementSpec[];
}

const VOID_TAGS = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'path', 'circle']);
const TEXT_TAGS = new Set(['p', 'blockquote', 'h1', 'h2', 'h3']);

/**
 * Every rendered text block on the marketing surface, WITH ITS ANCESTORS.
 *
 * The ancestors are the whole point and the reason this is a stack walk rather than a flat match.
 * The defect that prompted this file was inherited, not declared: `.aa-marketing-terms` set
 * `text-align: center` and the pricing paragraph said nothing at all. A guard that only read
 * declarations on the block itself would have looked at the defect and reported it clean — so the
 * chain is reconstructed and the value is resolved through inheritance, the way a browser does it.
 */
function marketingTextBlocks(): TextBlock[] {
  const blocks: TextBlock[] = [];
  const stack: ElementSpec[] = [];
  let open: { start: number; path: ElementSpec[] } | null = null;

  for (const match of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [tag, closing, attributes] = [String(match[2]), match[1] === '/', String(match[3])];

    if (closing) {
      if (open && TEXT_TAGS.has(tag) && stack.length === open.path.length) {
        const text = html
          .slice(open.start, match.index)
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const classes = open.path.at(-1)?.classes ?? [];
        if (text && classes.some((name) => /^aa-(marketing|hero)/.test(name))) {
          blocks.push({ classes, length: text.length, text, path: open.path });
        }
        open = null;
      }
      stack.pop();
      continue;
    }

    const classes = /class="([^"]*)"/.exec(attributes)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
    if (VOID_TAGS.has(tag) || attributes.trimEnd().endsWith('/')) {
      continue;
    }
    stack.push({ tag, classes });
    if (!open && TEXT_TAGS.has(tag)) {
      open = { start: (match.index ?? 0) + match[0].length, path: [...stack] };
    }
  }
  return blocks;
}

/** What the block's text alignment actually computes to — inherited from wherever it is set. */
const resolvedAlign = (block: TextBlock): string =>
  inheritedValue(rules, block.path, 'text-align', 375, 'start');

describe('marketing prose is not centred', () => {
  it('finds the blocks it is meant to walk', () => {
    // Guards against the whole file passing vacuously if the markup or the class prefix changes.
    const blocks = marketingTextBlocks();
    expect(
      blocks.length,
      'no marketing text blocks found — the walk is reading nothing'
    ).toBeGreaterThan(10);
    expect(
      blocks.some((block) => block.length > 100),
      'the page no longer renders a long block, so this guard is proving nothing'
    ).toBe(true);
  });

  it('centres nothing long enough to wrap without an argument for it', () => {
    for (const block of marketingTextBlocks()) {
      if (block.length <= WRAPS_ON_A_PHONE || resolvedAlign(block) !== 'center') {
        continue;
      }
      const argued = block.classes.find((name) => name in CENTRED_BY_ARGUMENT);
      expect(
        argued,
        `${block.classes[0]} is ${block.length} characters and centred, which on a phone is ` +
          'several ragged lines with no left edge to return to. Left-align it, or add it to ' +
          `CENTRED_BY_ARGUMENT with the reason it reads as a display line: "${block.text.slice(0, 60)}…"`
      ).toBeDefined();
    }
  });

  it('keeps no argument for a block that is no longer centred', () => {
    // The inverse, and the half that stops this file from rotting: an exception nobody removed is
    // an exception nobody rechecked, and it silently re-permits the defect if the class comes back.
    const centred = new Set(
      marketingTextBlocks()
        .filter((block) => resolvedAlign(block) === 'center')
        .flatMap((block) => block.classes)
    );

    for (const name of Object.keys(CENTRED_BY_ARGUMENT)) {
      expect(
        centred.has(name),
        `${name} is no longer centred, so its argument is stale — delete the entry rather than ` +
          'leaving a licence lying around for the next person who reaches for text-align: center'
      ).toBe(true);
    }
  });

  it('sets the terms card as one column rather than two paragraphs that can disagree', () => {
    // The specific regression. Alignment used to be declared per paragraph, which is exactly how the
    // card ended up holding one line set left and its sibling set centre; it is now declared once on
    // the container. Pinned as "the paragraphs do not declare it" so that re-introducing a
    // per-paragraph override — the shape of the original defect — fails here.
    const card: ElementSpec = { tag: 'section', classes: ['aa-marketing-terms'] };
    expect(winningDeclaration(rules, [card], 'text-align', 375)?.value).toBe('left');

    for (const child of ['aa-marketing-terms__price', 'aa-marketing-terms__oss']) {
      const path: ElementSpec[] = [card, { tag: 'p', classes: [child] }];
      // Composed result first: whatever the mechanism, this is what draws.
      expect(inheritedValue(rules, path, 'text-align', 375, 'start')).toBe('left');
      // Then the mechanism: the paragraph must not answer for itself, or the card holds two answers.
      expect(
        winningDeclaration(rules, path, 'text-align', 375)?.value,
        `${child} declares its own alignment again — that is the shape of the original defect, ` +
          'one paragraph left and its sibling centre inside a single card'
      ).toBeUndefined();
      expect(
        winningDeclaration(rules, path, 'max-width', 375)?.value,
        `${child} carries its own measure again — ch is font-relative, so the same value on two ` +
          'different type sizes is what put these paragraphs 38px apart in the first place'
      ).toBeUndefined();
    }
  });
});
