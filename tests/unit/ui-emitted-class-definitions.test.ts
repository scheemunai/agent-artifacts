import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import * as primitives from '../../src/ui/components/primitives.js';

/**
 * The placement guard, walked the OTHER WAY.
 *
 * `ui-css-placement` walks the stylesheet and asks every defined class for a consumer. That is one
 * direction, and it is blind by construction to the opposite failure: markup emitting a class the
 * stylesheet never defines. `.aa-badge--neutral` was on every badge-bearing screen in the product
 * and matched zero rules, and the walking guard could not see it — it was looking at definitions
 * for consumers, not at emissions for definitions.
 *
 * The two directions catch opposite things. A defined-but-unconsumed class is dead weight. An
 * emitted-but-undefined class is worse: it looks like styling to everyone who reads the markup, so
 * the next author copies it, and an inspector shows a class with no rules and no explanation.
 *
 * WALKED ALONG THE TYPES, which is what makes it more than a spot check. Each component is rendered
 * across the union its own props declare, read from the source rather than restated here — so a
 * tone added to a union without a rule to match fails here on the commit that adds it. Rendering
 * rather than reading is the other half: a component may legitimately SKIP a modifier (`neutral` is
 * the base appearance for badges and toasts), and only the rendered output knows the difference
 * between a class that is emitted and a string that appears in the source.
 */
const primitivesSource = readFileSync('src/ui/components/primitives.tsx', 'utf8');
const appCss = readFileSync('src/ui/assets/app.css', 'utf8');
const viewerCss = readFileSync('src/ui/assets/viewer.css', 'utf8');

/** Every class the stylesheet defines, from its selectors. */
const defined = new Set(
  Array.from(appCss.matchAll(/\.(-?[A-Za-z_][\w-]*)/g), (match) => String(match[1]))
);

/**
 * Both sheets, for the walk below. The rendering walk above only ever sees primitives, and every
 * primitive is styled by `app.css`; a page is not so lucky — the viewer's chrome lives in
 * `viewer.css`, and a walk that read one sheet would report every `aa-viewer-*` class as an orphan.
 */
const definedAnywhere = new Set([
  ...defined,
  ...Array.from(viewerCss.matchAll(/\.(-?[A-Za-z_][\w-]*)/g), (match) => String(match[1])),
]);

/** The members of an exported string union, read from the source it is declared in. */
function unionMembers(typeName: string): string[] {
  const declaration = new RegExp(`export type ${typeName}\\s*=\\s*([^;]+);`).exec(primitivesSource);
  const members = Array.from(declaration?.[1]?.matchAll(/'([\w-]+)'/g) ?? [], (match) =>
    String(match[1])
  );
  expect(members.length, `${typeName} is not an inline string union any more`).toBeGreaterThan(1);
  return members;
}

/**
 * The members of an inline union declared on a prop, e.g. `size?: 'sm' | 'md' | 'lg'`.
 *
 * Needed because not every variant axis has an exported type. Reading them anyway is the point of
 * the frame audit that added the last three cases below: the walk covered five components while
 * SEVEN places in `primitives.tsx` build a class name from a prop, and the three it missed were
 * exactly the ones whose unions were inline rather than named. A guard that only sees the
 * well-declared half of a pattern is a guard with a frame.
 */
function propUnion(interfaceName: string, prop: string): string[] {
  const block = new RegExp(`interface ${interfaceName}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(
    primitivesSource
  )?.[1];
  const declaration = new RegExp(`\\b${prop}\\??:([^;]+);`).exec(block ?? '')?.[1] ?? '';
  const members = Array.from(declaration.matchAll(/'([\w-]+)'/g), (match) => String(match[1]));
  expect(
    members.length,
    `${interfaceName}.${prop} is not an inline union any more`
  ).toBeGreaterThan(1);
  return members;
}

/** Each case renders one primitive across one prop's declared union. */
const CASES: Array<{ label: string; render: () => string[] }> = [
  {
    label: 'Badge tone',
    render: () =>
      unionMembers('BadgeTone').map((tone) =>
        renderToString(primitives.Badge({ tone: tone as never, children: 'x' }))
      ),
  },
  {
    label: 'Toast tone',
    render: () =>
      unionMembers('ToastTone').map((tone) =>
        renderToString(primitives.Toast({ tone: tone as never, children: 'x' }))
      ),
  },
  {
    label: 'Notice tone',
    render: () =>
      unionMembers('NoticeTone').map((tone) =>
        renderToString(primitives.Notice({ tone: tone as never, children: 'x' }))
      ),
  },
  {
    label: 'Button variant',
    render: () =>
      unionMembers('ButtonVariant').map((variant) =>
        renderToString(primitives.Button({ variant: variant as never, children: 'x' }))
      ),
  },
  {
    label: 'StatusHeading tone',
    render: () =>
      unionMembers('BadgeTone').map((tone) =>
        renderToString(
          primitives.StatusHeading({ tone: tone as never, status: 'Live', children: 'Title' })
        )
      ),
  },
  // The three the frame audit added. Each builds a class from a prop exactly like the five above;
  // the only thing that kept them out was that their unions are declared inline.
  {
    label: 'Button size',
    render: () =>
      propUnion('ButtonProps', 'size').map((size) =>
        renderToString(primitives.Button({ size: size as never, children: 'x' }))
      ),
  },
  {
    label: 'Badge size',
    render: () =>
      unionMembers('BadgeSize').map((size) =>
        renderToString(primitives.Badge({ size: size as never, children: 'x' }))
      ),
  },
  {
    label: 'Avatar size',
    render: () =>
      propUnion('AvatarProps', 'size').map((size) =>
        renderToString(primitives.Avatar({ size: size as never, name: 'Ada Byron' }))
      ),
  },
  {
    label: 'ButtonRow align',
    render: () =>
      unionMembers('ButtonRowAlign').map((align) =>
        renderToString(primitives.ButtonRow({ align: align as never, children: 'x' }))
      ),
  },
];

const emittedClasses = (html: string): string[] =>
  Array.from(html.matchAll(/class="([^"]*)"/g)).flatMap((match) =>
    String(match[1]).split(/\s+/).filter(Boolean)
  );

describe('every class the product emits is a class the stylesheet defines', () => {
  it('reads a stylesheet and a set of unions worth walking', () => {
    // Vacuity guard: if either side stops parsing, every assertion below passes for free.
    expect(defined.size).toBeGreaterThan(150);
    expect(defined.has('aa-badge')).toBe(true);
    expect(unionMembers('BadgeTone')).toContain('neutral');
  });

  it('emits no aa- class that no rule matches, across every declared variant', () => {
    const orphans = new Map<string, string>();

    for (const { label, render } of CASES) {
      for (const html of render()) {
        for (const className of emittedClasses(html)) {
          if (className.startsWith('aa-') && !defined.has(className)) {
            orphans.set(className, label);
          }
        }
      }
    }

    expect(
      [...orphans].map(([className, label]) => `${className} (from ${label})`),
      'these classes reach the browser and match no rule. Either define them, or skip the ' +
        'modifier the way a base-appearance tone is skipped — a class with no rules still reads ' +
        'as styling to the next person who inspects the element or copies the markup.'
    ).toEqual([]);
  });

  it('narrows a component’s union to what it can actually render', () => {
    // The defect this pins is a type promising more than the CSS delivers. `Toast` borrowed
    // `BadgeTone`, which carries `accent`, and there is no `.aa-toast--accent`: a caller following
    // the types would have got an unstyled toast and no error from anywhere. Nothing passed it, so
    // nothing broke — which is exactly why it survived.
    //
    // Asserted as an absence rather than by re-listing the tones, so the day someone adds
    // `.aa-toast--accent` this stops complaining on its own.
    for (const tone of unionMembers('ToastTone')) {
      if (tone === 'neutral') {
        continue;
      }
      expect(
        defined.has(`aa-toast--${tone}`),
        `ToastTone offers "${tone}" and .aa-toast--${tone} does not exist`
      ).toBe(true);
    }

    expect(
      unionMembers('NoticeTone').every((tone) => defined.has(`aa-notice--${tone}`)),
      'NoticeTone offers a tone the stylesheet cannot render'
    ).toBe(true);
  });
});

/**
 * THE SAME WALK, WITH THE FRAME TAKEN OFF.
 *
 * The walk above renders components across their declared unions, which is the strongest form of
 * this check and the narrowest: it can only see `primitives.tsx`, because only a primitive can be
 * rendered from its own type. Pages need props, so pages were never walked — and pages are where
 * the classes are.
 *
 * An audit of the whole of `src/ui` found ELEVEN `aa-` classes reaching the browser with no rule
 * behind them, and ten of them were outside this file's frame. The worst was `.aa-legal__heading`:
 * emitted on every legal page, defined nowhere, so the compiled preflight's
 * `h1..h6 { font-size: inherit; font-weight: inherit }` was the last word and fourteen section
 * headings on the Terms page rendered at body size and body weight — on the pages a customer reads
 * immediately before paying. `.aa-hint--warning` was the same defect with money attached: the
 * failed-payment banner, in the grey of a form caption.
 *
 * This walk is static rather than rendered, and that trade is deliberate and stated: it reads class
 * literals out of the source instead of executing components, so it cannot see a class built at
 * runtime from a prop — the rendered walk above covers that case for the primitives, which is where
 * that pattern lives. What it CAN see is every literal in every page and component, which is
 * exactly the population that was invisible.
 */
function uiSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return uiSourceFiles(path);
    }
    return /\.(tsx?|js)$/.test(path) ? [path] : [];
  });
}

/** Every `aa-` class written as a literal anywhere under `src/ui`, with the file that writes it. */
function emittedLiterals(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const record = (className: string, file: string): void => {
    if (!className.startsWith('aa-')) {
      return;
    }
    const files = found.get(className) ?? new Set<string>();
    files.add(file);
    found.set(className, files);
  };

  for (const file of uiSourceFiles('src/ui')) {
    const source = readFileSync(file, 'utf8');
    // `class="a b"` — the plain form, in JSX and in template strings alike.
    for (const attribute of source.matchAll(/class(?:Name)?="([^"{}]+)"/g)) {
      for (const className of String(attribute[1]).split(/\s+/).filter(Boolean)) {
        record(className, file);
      }
    }
    // `cx('a', flag && 'b')` — the conditional form. Only the literals; a template is runtime.
    for (const call of source.matchAll(/\bcx\(([^)]*)\)/g)) {
      for (const literal of String(call[1]).matchAll(/'([a-zA-Z][\w\- ]*)'/g)) {
        for (const className of String(literal[1]).split(/\s+/).filter(Boolean)) {
          record(className, file);
        }
      }
    }
  }
  return found;
}

describe('every class any page emits is a class some stylesheet defines', () => {
  const emitted = emittedLiterals();

  it('walks the whole of src/ui rather than one module', () => {
    // Vacuity guard, and a floor that fails if the scan stops finding pages.
    expect(emitted.size).toBeGreaterThan(150);
    expect(emitted.get('aa-legal__heading')?.size ?? 0).toBe(1);
    expect(definedAnywhere.has('aa-viewer-chrome')).toBe(true);
  });

  it('emits no aa- class that no rule in either stylesheet matches', () => {
    const orphans = [...emitted]
      .filter(([className]) => !definedAnywhere.has(className))
      .map(([className, files]) => `${className} (${[...files].sort().join(', ')})`)
      .sort();

    expect(
      orphans,
      'these classes reach the browser and match no rule in app.css or viewer.css. Define them or ' +
        'stop emitting them — a class with no rules looks like styling to everyone who reads the ' +
        'markup, and the element it is on silently takes whatever the preflight left behind.'
    ).toEqual([]);
  });
});
