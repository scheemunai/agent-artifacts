import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { Button, ButtonRow } from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import { readClientSource } from '../support/client-assets.js';
import {
  declarationValue,
  type ElementSpec,
  maxLength,
  parseStylesheet,
  resolveVars,
  themeVariables,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * Width used to be an accident. Seven container widths shipped as raw rem literals under seven
 * different class names with nothing naming the scale, and a Button's width was decided by whether
 * its parent happened to be a grid — the same component rendered 432px, 131px and 1062px on three
 * screens. These tests hold both decisions where they belong: in a token and in a prop.
 */
const appCssSource = readFileSync('src/ui/assets/app.css', 'utf8');
const appRules = parseStylesheet(appCssSource);
const variables = themeVariables(appCssSource);

const widthTokens = Array.from(variables.keys()).filter((name) => name.startsWith('--width-aa-'));

describe('width tokens', () => {
  it('names a width scale instead of scattering rem literals', () => {
    expect(widthTokens.length).toBeGreaterThanOrEqual(8);

    for (const token of widthTokens) {
      expect(variables.get(token), token).toMatch(/^[\d.]+(?:rem|ch|px)$/);
    }
  });

  it('resolves every container width through a token', () => {
    const containers = appRules.filter((rule) => {
      const width = declarationValue(rule.block, 'width');
      return Boolean(width?.startsWith('min('));
    });

    expect(containers.length).toBeGreaterThan(6);

    for (const rule of containers) {
      expect(declarationValue(rule.block, 'width'), rule.selector).toMatch(
        /var\(--width-aa-[\w-]+\)/
      );
    }
  });

  it('keeps the scale free of tokens nothing uses', () => {
    for (const token of widthTokens) {
      expect(appCssSource.split(`var(${token})`).length - 1, `${token} is unused`).toBeGreaterThan(
        0
      );
    }
  });
});

/**
 * THE HEADER AND THE PAGE UNDER IT ARE ONE COLUMN, MEASURED RATHER THAN EYEballed.
 *
 * The defect this locks: `.aa-marketing-shell` carried a container width of its own — 66.5rem
 * against the 72rem every page's own content used — so on /templates and the legal pages the
 * header band was inset 44px further on the left and stopped 44px short on the right. The wordmark
 * therefore started to the RIGHT of the page heading beneath it, and the header's right edge
 * stopped before the card grid's. Nothing in the markup or the class names said the two had to
 * agree, so nothing failed when they stopped agreeing.
 *
 * WHY THIS ASSERTS COMPUTED PIXELS AND NOT A TOKEN NAME. "Both use `--width-aa-shell`" is the fix
 * as written today and would pass just as happily if one of them later moved to a same-valued
 * alias, or if a media query gave one of them a different padding. The claim a reader actually has
 * — the header starts where the content starts — is about resolved left and right edges, so that
 * is what is compared: same width expression AND same inline padding, at every breakpoint the
 * sheet distinguishes.
 *
 * Both are centred by `margin-inline: auto`, so equal outer width plus equal inline padding is
 * equal left and right edges at any viewport. The end-to-end check that they land there in a real
 * browser is smoke.spec's business; this is the sheet-level guarantee that they cannot diverge.
 */
describe('the marketing chrome and the page it wraps share one measure', () => {
  const shell = (classes: string[], tag = 'div'): ElementSpec[] => [{ tag, classes }];

  /** Every surface that renders the marketing header and footer, plus those two bands. */
  const surfaces: Record<string, ElementSpec[]> = {
    'marketing header inner': [
      { tag: 'header', classes: ['aa-app-header'] },
      { tag: 'div', classes: ['aa-shell', 'aa-marketing-shell', 'aa-app-nav'] },
    ],
    'marketing footer inner': [
      { tag: 'footer', classes: ['aa-marketing-footer'] },
      { tag: 'div', classes: ['aa-shell', 'aa-marketing-shell'] },
    ],
    'home main': [
      { tag: 'main', classes: ['aa-main', 'aa-marketing-main'] },
      { tag: 'div', classes: ['aa-shell', 'aa-marketing-shell'] },
    ],
    'templates main': shell(['aa-main', 'aa-shell', 'aa-templates'], 'main'),
    'legal main': shell(['aa-main', 'aa-shell', 'aa-legal'], 'main'),
  };

  // The sheet's own breakpoints plus the four widths the founder's report was measured at.
  const viewports = [390, 480, 560, 720, 768, 760, 1280, 1440, 1920];

  /**
   * `maxLength` has no notion of a containing block, so `100%` is substituted here rather than
   * taught to the resolver. Every surface below is a child of a viewport-wide box — `body`, the
   * sticky header, `main` — so for these five, and only these five, `100%` IS the viewport. Written
   * as a local narrowing on purpose: a general `100% = viewport` rule in the shared resolver would
   * be wrong for the majority of elements that use it.
   */
  const pixels = (value: string, viewport: number) =>
    maxLength(resolveVars(value, variables).replaceAll('100%', `${viewport}px`), viewport);

  const resolvedWidth = (path: ElementSpec[], viewport: number) => {
    const declared = winningDeclaration(appRules, path, 'width', viewport);
    expect(declared, `no width resolves for ${JSON.stringify(path)}`).toBeDefined();
    return pixels(declared?.value ?? '', viewport);
  };

  const resolvedPadding = (path: ElementSpec[], viewport: number) => {
    const declared = winningDeclaration(appRules, path, 'padding-inline', viewport);
    expect(declared, `no padding-inline resolves for ${JSON.stringify(path)}`).toBeDefined();
    return pixels(declared?.value ?? '', viewport);
  };

  it.each(viewports)('puts every marketing surface on identical bounds at %ipx', (viewport) => {
    const entries = Object.entries(surfaces);
    const [, reference] = entries[0] as [string, ElementSpec[]];
    const referenceWidth = resolvedWidth(reference, viewport);
    const referencePadding = resolvedPadding(reference, viewport);

    for (const [name, path] of entries) {
      expect(resolvedWidth(path, viewport), `${name} width at ${viewport}`).toBe(referenceWidth);
      expect(resolvedPadding(path, viewport), `${name} padding-inline at ${viewport}`).toBe(
        referencePadding
      );
    }
  });

  it('keeps exactly one page-width token in the scale', () => {
    // A second one is how the two drifted. `--width-aa-panel` and `--width-aa-measure` are columns
    // laid INSIDE a page, which is a composition; a second full-page measure is a fork.
    expect(widthTokens.filter((token) => token.startsWith('--width-aa-shell'))).toEqual([
      '--width-aa-shell',
      '--width-aa-shell-narrow',
    ]);
  });
});

describe('button width is a decision, not an inheritance', () => {
  const gridChildButton = [
    { tag: 'form', classes: ['aa-stack'] },
    { tag: 'button', classes: ['aa-btn', 'aa-btn--primary'] },
  ];

  it('never lets a grid parent stretch a default button', () => {
    // `.aa-stack` is a grid; a Button dropped straight into one used to stretch to the full
    // container, so "Change password" rendered 432px wide beside a 131px "Remove password".
    expect(winningDeclaration(appRules, gridChildButton, 'justify-self', 1440)?.value).toBe(
      'start'
    );
  });

  it('makes full width an explicit prop with its own class', () => {
    const auto = renderToString(Button({ children: 'Save', variant: 'primary' }));
    const full = renderToString(Button({ children: 'Save', variant: 'primary', fullWidth: true }));

    expect(auto).not.toContain('aa-btn--full');
    expect(full).toContain('aa-btn--full');

    const fullWidthRule = appRules.find((rule) => rule.selector === '.aa-btn--full');
    expect(declarationValue(fullWidthRule?.block ?? '', 'width')).toBe('100%');
    expect(declarationValue(fullWidthRule?.block ?? '', 'justify-self')).toBe('stretch');
  });
});

describe('ButtonRow', () => {
  it('wraps action rows in a real primitive that wraps at 375', () => {
    const html = renderToString(
      ButtonRow({
        children: [
          Button({ children: 'Publish', variant: 'primary' }),
          Button({ children: 'Cancel', variant: 'ghost' }),
        ],
      })
    );

    expect(html).toContain('aa-button-row');

    const rule = appRules.find((candidate) => candidate.selector === '.aa-button-row');
    expect(declarationValue(rule?.block ?? '', 'display')).toBe('flex');
    expect(declarationValue(rule?.block ?? '', 'flex-wrap')).toBe('wrap');
    expect(declarationValue(rule?.block ?? '', 'gap')).toBeDefined();
  });

  it('offers the alignments production action rows actually need', () => {
    for (const alignment of ['center', 'end', 'between'] as const) {
      expect(
        appRules.some((rule) => rule.selector === `.aa-button-row--${alignment}`),
        `.aa-button-row--${alignment}`
      ).toBe(true);
    }

    expect(renderToString(ButtonRow({ align: 'end', children: 'x' }))).toContain(
      'aa-button-row--end'
    );
  });

  it('is registered in the style guide with the width scale', () => {
    const html = renderToString(StyleGuidePage());

    expect(html).toContain('Width and action rows');
    expect(html).toContain('--width-aa-shell');
    expect(html).toContain('aa-button-row');
  });
});

describe('icon-only controls read as controls', () => {
  it('gives a mark-only button a square box at the touch floor', () => {
    // `min-height` was honoured everywhere and `min-width` was set nowhere, so an icon-only button
    // computed to 33x44 — under the 44px floor on one axis.
    const rule = appRules.find((candidate) => candidate.selector === '.aa-btn--icon');
    expect(rule, 'no .aa-btn--icon rule').toBeDefined();

    expect(declarationValue(rule?.block ?? '', 'min-width')).toBe('var(--spacing-aa-touch)');
    expect(declarationValue(rule?.block ?? '', 'width')).toBe('var(--spacing-aa-touch)');
    expect(
      renderToString(Button({ children: '↻', iconOnly: true, ariaLabel: 'Refresh' }))
    ).toContain('aa-btn--icon');
  });

  it('gives the viewer refresh control a box beside the bordered Download button', () => {
    // The control was never unlabelled — it has carried an accessible name and a tooltip
    // throughout. A bare 14px muted glyph with no border beside a bordered button simply does not
    // read as a control, which is an affordance defect, not an a11y one.
    const viewerSource = readFileSync('src/ui/pages/viewer.tsx', 'utf8');
    const refresh = /<Button[\s\S]*?data-aa-refresh[\s\S]*?>/.exec(viewerSource)?.[0] ?? '';

    expect(refresh).toContain('iconOnly');
    expect(refresh).toContain('variant="secondary"');
    // Still named, still tooltipped. Do not "fix" this by adding a third label.
    expect(refresh).toContain('ariaLabel="Refresh artifact"');
    expect(refresh).toContain('title="Refresh artifact"');
  });

  it('keeps the mark in place while the control is busy', () => {
    // Swapping the glyph for the word "Refreshing…" reflowed a control that is now a fixed square.
    const viewerScript = readClientSource('viewer.js');

    expect(viewerScript).not.toMatch(/refreshButton\.textContent\s*=/);
    expect(viewerScript).toContain("setAttribute('aria-busy'");
  });
});
