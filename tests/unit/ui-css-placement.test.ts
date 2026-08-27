import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The placement ruling, made checkable.
 *
 * `app.css` is a foundation file, and the failure mode for a foundation file is accretion: every
 * page author adds "just this one rule", and two rounds later a third of the stylesheet answers to
 * no component. That is precisely how this product ended up with `aa-specimen-row` — a style-guide
 * class — shipping at 25 production call sites.
 *
 * The rule: `app.css` holds what a component owns and the style guide documents. CSS for a single
 * page means a component is missing. The one exception is a page's own layout scaffolding, named
 * for its page, which must graduate to a component the moment a second page wants it.
 *
 * The evidence behind keeping the marketing block where it is: `.aa-marketing-*` is the largest
 * family in the file, but it is backed by `src/ui/components/marketing.tsx` and registered in the
 * guide at `#marketing-components`. It is a component family with a narrow audience, not page CSS,
 * so it stays. `.aa-home-shell` was neither — defined, used nowhere — and is gone.
 */
const appCss = readFileSync('src/ui/assets/app.css', 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

const sources = new Map(sourceFiles('src/ui').map((path) => [path, readFileSync(path, 'utf8')]));

/** Class names defined in the stylesheet that are scoped to a page or a page-facing family. */
const pageScoped = [
  ...new Set(
    Array.from(appCss.matchAll(/\.(aa-(?:home|marketing)-[\w-]+)/g), (match) => String(match[1]))
  ),
];

function consumersOf(className: string): string[] {
  // A class may be applied literally, or built from a prefix (`aa-marketing-api__${part}`), so a
  // family prefix counts as use. Anything with no consumer at all is dead weight in a shared file.
  const family = className.replace(/(__|--)[\w-]+$/, '');
  return [...sources]
    .filter(([, source]) => source.includes(className) || source.includes(`${family}__`))
    .map(([path]) => path);
}

describe('css placement', () => {
  it('finds the page-scoped families it is meant to police', () => {
    expect(pageScoped.length).toBeGreaterThan(20);
  });

  it('defines no page-scoped class that nothing uses', () => {
    const dead = pageScoped.filter((className) => consumersOf(className).length === 0);

    expect(dead, `dead page-scoped CSS in app.css: ${dead.join(', ')}`).toEqual([]);
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
