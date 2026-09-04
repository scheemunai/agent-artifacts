import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStylesheet } from '../support/css-cascade.js';

/**
 * The placement ruling, made checkable — as a WALK, not a list.
 *
 * `app.css` is a foundation file, and the failure mode for a foundation file is accretion: every
 * author adds "just this one rule", and two rounds later a share of the stylesheet answers to
 * nothing. The rule: `app.css` holds what a component owns and the style guide documents. CSS for
 * a single page means a component is missing.
 *
 * This guard used to police two enumerated families, `aa-home-*` and `aa-marketing-*`. It passed
 * cleanly while `.aa-app-nav__account` sat in the sheet matching NOTHING — dead from the commit
 * that added it until the NavShell slot gave it a consumer — because the dead class did not happen
 * to fall in either family. That is the same defect this file's own history is made of: the
 * `aa-specimen-row` alias was retired *because* an enumerated list guards the things somebody
 * remembered to list, and the whole point of the class is that it spreads to the ones nobody is
 * thinking about. Three list-shaped guards have failed that way; this one is rewritten to walk.
 *
 * So: every class the stylesheet defines must have a consumer in `src/`, and the exceptions are
 * named individually with a reason. An unconsumed class now has to be ARGUED for. Not matching a
 * pattern is no longer a defence.
 */
const appCss = readFileSync('src/ui/assets/app.css', 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    // `.js` matters: since the assets refactor the client bundles are source files too, and they
    // are where the script-driven classes are applied from. Walking only `.tsx` would report every
    // one of those as dead.
    return /\.(tsx?|js)$/.test(path) ? [path] : [];
  });
}

const STYLE_GUIDE = 'src/ui/pages/style-guide.tsx';
const sourcePaths = sourceFiles('src');
const sources = sourcePaths.map((path) => readFileSync(path, 'utf8'));
/** Every source file at once. Which file uses a class is not this guard's question. */
const consumers = sources.join('\n');
/**
 * The same corpus with the style guide taken out — and that omission is the whole of the second
 * assertion below.
 *
 * This guard asks every defined class for a consumer, by text search, over all of `src`. The style
 * guide is in `src`, so a class the guide hand-writes a specimen for counts as consumed, and the
 * guard reports nothing. That is not a hypothetical hole: `.task-list-item` sat in it for the life
 * of the product (the renderer emits no such class; the guide's specimen was its only wearer) and
 * `.aa-md-table-scroll` sat beside it, described in the guide as an optional wrapper and applied by
 * nothing. Both were real defects — the first put a bullet nowhere, the second left every markdown
 * table drawing its border at the column width — and this file passed cleanly through all of it.
 *
 * A specimen is a promise that the product renders something. When it is the only consumer, the
 * promise is the only thing that exists.
 */
const nonGuideConsumers = sourcePaths
  .map((path, index) => (path === STYLE_GUIDE ? '' : (sources[index] ?? '')))
  .join('\n');

/** Every class the stylesheet defines, from selectors only — comments are already stripped. */
const declared = [
  ...new Set(
    parseStylesheet(appCss).flatMap((rule) =>
      Array.from(rule.selector.matchAll(/\.(-?[A-Za-z_][\w-]*)/g), (match) => String(match[1]))
    )
  ),
].sort();

/**
 * Classes with no consumer that have earned their place, each carrying the argument for keeping it.
 *
 * This is the pressure valve, and it is deliberately the kind that cannot quietly rot: a test below
 * asserts every entry is STILL unconsumed, so an entry that gets adopted has to be deleted rather
 * than left sitting here looking like policy.
 */
const ARGUED_FOR: Array<{ className: string; reason: string }> = [
  // Empty, and that is the goal state rather than an accident of timing.
  //
  // It had one entry for as long as it took to ask. `.aa-preview-frame` shared a declaration block
  // with `.aa-card__body > iframe` and existed as a name a page could opt into outside a card body;
  // nothing ever opted in. I argued for keeping it because another test pinned it — then its owner
  // said they had no attachment to it, which removed the only leg the argument stood on, so it was
  // retired instead. That is the mechanism working: the entry existed to make someone defend the
  // class, and once nobody would, the class went.
];

/**
 * A class may be applied literally, or built from a prefix — `aa-btn--${variant}`. The second form
 * cannot be resolved without knowing every runtime value, so a real template construction with
 * this exact prefix counts as a consumer.
 *
 * Honest limit, stated rather than implied: 38 of the classes in this sheet are held only by that
 * escape hatch, and it cannot tell `aa-btn--primary` from an `aa-btn--` variant nothing ever
 * passes. Narrowing it further needs dataflow analysis this guard does not justify. What it does
 * buy is that a whole family going dead is still caught, and a standalone class — which is what
 * `.aa-app-nav__account` was — has nowhere to hide.
 */
function hasConsumer(className: string, corpus: string = consumers): boolean {
  // Bounded, so `aa-btn` is not counted as used by the text `aa-btn--primary`.
  if (new RegExp(`(?<![\\w-])${className}(?![\\w-])`).test(corpus)) {
    return true;
  }
  const family = className.replace(/(__|--)[\w-]+$/, '');
  if (family === className) {
    return false;
  }
  const separator = className.slice(family.length, family.length + 2);
  return corpus.includes(`${family}${separator}\${`);
}

/**
 * Classes the style guide is the component FOR, rather than the specimen of.
 *
 * The swatches, the token cards and the usage notes exist to draw the guide itself; there is no
 * product page they are missing from, and asking for one would be asking the wrong question. Every
 * entry carries the argument, exactly as `ARGUED_FOR` does, because the moment this becomes a
 * pattern match it stops being a decision anyone has to defend.
 */
const GUIDE_FURNITURE: Array<{ prefix: string; reason: string }> = [
  {
    prefix: 'aa-swatch',
    reason:
      'The colour chips the guide paints its palette with. The modifier is built from the token ' +
      'name at render time, so the family is generated rather than written, and no product surface ' +
      'shows a palette — the guide IS the consumer, not a stand-in for one.',
  },
  {
    prefix: 'aa-token-',
    reason:
      'The token table rows: name, value and the sentence saying what the token is for. This is ' +
      'documentation furniture with no product equivalent; a page that needed to render a design ' +
      'token would be a page that had lost the argument about where tokens live.',
  },
  {
    prefix: 'aa-usage',
    reason:
      'The "when to use this" note above each specimen. It exists so a component section can carry ' +
      'its own guidance next to the thing it describes, which is a property of the guide as a ' +
      'document and not of any component the guide documents.',
  },
  {
    prefix: 'aa-grid--3',
    reason:
      'One step of the layout scale. `aa-grid--2` is used by the dashboard, and the scale is the ' +
      'unit here: deleting the three-column step because no page needs three columns today would ' +
      'leave the system with a gap that the next author fills with a one-off grid.',
  },
];

function isGuideFurniture(className: string): boolean {
  return GUIDE_FURNITURE.some((entry) => className.startsWith(entry.prefix));
}

describe('css placement', () => {
  it('walks the whole stylesheet rather than a list of families', () => {
    // The guard this replaces policed about twenty-five names. If this ever collapses back to a
    // handful, the parser has broken and every assertion below is passing vacuously.
    expect(declared.length).toBeGreaterThan(150);
    expect(sources.length).toBeGreaterThan(50);
    // Not just the `aa-` prefix: whatever the sheet defines, the sheet has to justify.
    expect(declared).toContain('sr-only');
  });

  it('defines no class that nothing in src/ uses', () => {
    const argued = new Set(ARGUED_FOR.map((entry) => entry.className));
    const orphans = declared.filter(
      (className) => !argued.has(className) && !hasConsumer(className)
    );

    expect(
      orphans,
      `defined in app.css and used nowhere in src/: ${orphans.join(', ')}. Give them a consumer, ` +
        'delete them, or add them to ARGUED_FOR with the reason they stay — an unconsumed class ' +
        'has to be argued for, not merely unlisted.'
    ).toEqual([]);
  });

  it('lets no product class rely on the style guide as its only consumer', () => {
    // The hole this closes, in one sentence: a specimen is a promise that the product renders
    // something, and when the specimen is the only consumer the promise is all there is.
    // `.task-list-item` and `.aa-md-table-scroll` both lived here — styled, documented, specimened,
    // and applied by nothing — until the markdown renderer was fixed to emit them. `.aa-list*` was
    // still here: a five-class row component with its own cascade test that no page had ever
    // rendered. It was deleted rather than adopted.
    const argued = new Set(ARGUED_FOR.map((entry) => entry.className));
    const guideOnly = declared.filter(
      (className) =>
        !argued.has(className) &&
        !isGuideFurniture(className) &&
        hasConsumer(className) &&
        !hasConsumer(className, nonGuideConsumers)
    );

    expect(
      guideOnly,
      `defined in app.css and consumed only by the style guide: ${guideOnly.join(', ')}. Either a ` +
        'page renders it, or it is furniture the guide itself owns and belongs in GUIDE_FURNITURE ' +
        'with the argument, or it is dead and goes.'
    ).toEqual([]);
  });

  it('keeps the furniture argued for, and only where it is still unused', () => {
    for (const { prefix, reason } of GUIDE_FURNITURE) {
      expect(reason.length, `${prefix} is allow-listed without a real argument`).toBeGreaterThan(
        80
      );
      const covered = declared.filter((className) => className.startsWith(prefix));
      expect(covered.length, `${prefix} covers nothing in the stylesheet any more`).toBeGreaterThan(
        0
      );
      expect(
        covered.some((className) => hasConsumer(className, nonGuideConsumers)),
        `${prefix} is claimed as guide furniture but a product page now renders it — take it out ` +
          'of GUIDE_FURNITURE so this list keeps meaning what it says'
      ).toBe(false);
    }
  });

  it('keeps every exception arguable, and lets none outlive its argument', () => {
    for (const { className, reason } of ARGUED_FOR) {
      expect(declared, `${className} is allow-listed but no longer defined`).toContain(className);
      // The reason is the whole mechanism. A one-word entry is an enumerated list again, wearing a
      // different shape.
      expect(reason.length, `${className} is allow-listed without a real argument`).toBeGreaterThan(
        80
      );
      expect(
        hasConsumer(className),
        `${className} now has a consumer — delete its ARGUED_FOR entry so this list keeps meaning ` +
          'what it says'
      ).toBe(false);
    }
  });

  it('keeps a family in app.css only while a component owns it', () => {
    // `.aa-marketing-*` earns its place: a component module renders it and the guide documents it.
    // If that ever stops being true, the family is page CSS and belongs behind a component.
    const marketing = readFileSync('src/ui/components/marketing.tsx', 'utf8');
    const guide = readFileSync('src/ui/pages/style-guide.tsx', 'utf8');

    expect(marketing).toContain('aa-marketing-');
    expect(guide).toContain('marketing-components');
  });

  it('states the rule where the next page author will look for it', () => {
    const guide = readFileSync('src/ui/pages/style-guide.tsx', 'utf8');

    expect(guide).toContain('Where CSS lives');
    expect(guide).toContain('a component is missing');
  });
});
