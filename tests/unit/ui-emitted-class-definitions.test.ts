import { readFileSync } from 'node:fs';
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

/** Every class the stylesheet defines, from its selectors. */
const defined = new Set(
  Array.from(appCss.matchAll(/\.(-?[A-Za-z_][\w-]*)/g), (match) => String(match[1]))
);

/** The members of an exported string union, read from the source it is declared in. */
function unionMembers(typeName: string): string[] {
  const declaration = new RegExp(`export type ${typeName}\\s*=\\s*([^;]+);`).exec(primitivesSource);
  const members = Array.from(declaration?.[1]?.matchAll(/'([\w-]+)'/g) ?? [], (match) =>
    String(match[1])
  );
  expect(members.length, `${typeName} is not an inline string union any more`).toBeGreaterThan(1);
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
