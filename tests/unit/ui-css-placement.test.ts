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

const sources = sourceFiles('src').map((path) => readFileSync(path, 'utf8'));
/** Every source file at once. Which file uses a class is not this guard's question. */
const consumers = sources.join('\n');

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
  {
    className: 'aa-preview-frame',
    reason:
      'Not an orphan rule — it shares its declaration block with `.aa-card__body > iframe`, which ' +
      'is consumed, and exists as the name for that same box when a page needs it outside a card ' +
      'body. `tests/unit/ui-prose-scope.test.ts` pins the class by name as a deliberate opt-in, so ' +
      'retiring it is that contract owner’s call and not this guard’s.',
  },
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
function hasConsumer(className: string): boolean {
  // Bounded, so `aa-btn` is not counted as used by the text `aa-btn--primary`.
  if (new RegExp(`(?<![\\w-])${className}(?![\\w-])`).test(consumers)) {
    return true;
  }
  const family = className.replace(/(__|--)[\w-]+$/, '');
  if (family === className) {
    return false;
  }
  const separator = className.slice(family.length, family.length + 2);
  return consumers.includes(`${family}${separator}\${`);
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
