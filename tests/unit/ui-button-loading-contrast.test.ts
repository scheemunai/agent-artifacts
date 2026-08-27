import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseStylesheet,
  resolveVars,
  specificity,
  themeVariables,
} from '../support/css-cascade.js';

/**
 * A-16. `Button` renders `disabled` whenever it is loading — correct, since a submit in flight must
 * not fire twice — and the disabled rule dims the whole control to `opacity: 0.55`. So a loading
 * button was pixel-identical to a dead one, and its label dropped to roughly 2.3:1 against the page.
 *
 * Loading is not disabled. It is the state where something *is* happening, and it is the state a
 * user stares at while waiting, which makes it the worst one to render as unreadable. The two must
 * differ visually and the loading label has to stay legible.
 *
 * The maths below is the point: an opacity on the button composites both its fill and its text
 * toward the page behind it, so the ratio has to be computed on the composited colours rather than
 * on the tokens as authored. Asserting "opacity is not 0.55" would pass on any other dimming value
 * that is equally unreadable.
 */
const css = readFileSync('src/ui/assets/app.css', 'utf8');
const rules = parseStylesheet(css);
const theme = themeVariables(css);

type Rgb = [number, number, number];

function hex(token: string): Rgb {
  const value = resolveVars(`var(${token})`, theme).trim();
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match?.[1]) {
    throw new Error(`${token} is not a plain hex colour: ${value}`);
  }
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** Flatten a colour drawn at `alpha` over an opaque backdrop, which is what `opacity` does. */
function composite(front: Rgb, back: Rgb, alpha: number): Rgb {
  return front.map((channel, index) =>
    Math.round(channel * alpha + (back[index] as number) * (1 - alpha))
  ) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const linear = [r, g, b].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

function block(selector: string): string {
  return (
    rules.find((rule) =>
      rule.selector
        .split(',')
        .map((part) => part.trim())
        .includes(selector)
    )?.block ?? ''
  );
}

function declaration(selector: string, property: string): string | undefined {
  return new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(block(selector))?.[1]?.trim();
}

const PAGE = hex('--color-aa-bg');
const PRIMARY_FILL = hex('--color-aa-accent');
const PRIMARY_INK = hex('--color-aa-accent-ink');

const DISABLED_SELECTOR = '.aa-btn:disabled';
const LOADING_SELECTOR = '.aa-btn:disabled[aria-busy="true"]';

/**
 * Every assertion below reads a declaration out of the stylesheet, and a missing rule reads as
 * `undefined` — which silently becomes "opacity 1", i.e. a pass. So the rule's existence is
 * asserted first, on its own. Written after this exact test suite passed 3/3 against a stylesheet
 * that did not yet contain the rule.
 */
function requiredDeclaration(selector: string, property: string): string {
  const value = declaration(selector, property);
  expect(value, `${selector} declares no ${property}`).toBeDefined();
  return value as string;
}

describe('a loading button is not a disabled button', () => {
  it('declares a loading treatment at all', () => {
    expect(block(LOADING_SELECTOR), `${LOADING_SELECTOR} is not in app.css`).not.toBe('');
    expect(block(DISABLED_SELECTOR), `${DISABLED_SELECTOR} is not in app.css`).not.toBe('');
  });

  it('keeps the loading label legible against its own fill', () => {
    const opacity = Number(requiredDeclaration(LOADING_SELECTOR, 'opacity'));
    const ink = composite(PRIMARY_INK, PAGE, opacity);
    const fill = composite(PRIMARY_FILL, PAGE, opacity);

    // 4.5:1 is the WCAG AA floor for body-sized text, which is what a button label is.
    expect(
      contrast(ink, fill),
      `loading label contrast at opacity ${opacity}`
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('does not render loading with the disabled treatment', () => {
    const disabledOpacity = Number(requiredDeclaration(DISABLED_SELECTOR, 'opacity'));
    const loadingOpacity = Number(requiredDeclaration(LOADING_SELECTOR, 'opacity'));

    // The defect: identical fills. The measured 2.3:1 is reproduced here from the disabled value,
    // so this test also documents what was wrong rather than only what is right.
    const disabledInk = composite(PRIMARY_INK, PAGE, disabledOpacity);
    const disabledFill = composite(PRIMARY_FILL, PAGE, disabledOpacity);
    expect(contrast(disabledInk, disabledFill)).toBeLessThan(4.5);

    expect(loadingOpacity, 'loading is dimmed exactly like disabled').not.toBe(disabledOpacity);

    // Still non-interactive. The fix is that a busy button must not *look* dead, not that it should
    // become clickable mid-request — so the loading rule deliberately declares no `pointer-events`
    // and inherits `none` from the disabled rule it overrides on colour alone.
    expect(
      declaration(LOADING_SELECTOR, 'pointer-events'),
      'loading re-enables pointer events'
    ).toBeUndefined();
    expect(declaration(DISABLED_SELECTOR, 'pointer-events')).toBe('none');
  });

  it('wins the cascade by specificity, not by being written later', () => {
    // The recurring trap in this stylesheet: a rule that merely ties `.aa-btn:disabled` depends on
    // source order, and source order is the first thing an edit disturbs.
    const rank = (selector: string) => {
      const [ids, classes, elements] = specificity(selector);
      return ids * 10_000 + classes * 100 + elements;
    };

    expect(
      rank(LOADING_SELECTOR),
      'loading only ties disabled — source order decides'
    ).toBeGreaterThan(rank(DISABLED_SELECTOR));
  });
});
