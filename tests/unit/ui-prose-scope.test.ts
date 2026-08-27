import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readClientSource } from '../support/client-assets.js';
import {
  declarationValue,
  type ElementSpec,
  parseStylesheet,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * `renderMarkdown()` stamps `class="aa-md"` onto every piece of rendered markdown in the product —
 * the public artifact page, the dashboard's preview cards, the promote panel, the template
 * preview. But `.aa-md` carried *page* geometry: `margin: 4rem auto 0`, `padding-inline: 1.5rem`,
 * `width: min(100%, 72ch)`. So every in-card preview inherited a 64px phantom top margin, a second
 * inset inside an already-padded card, and a 72ch column centred inside a 1080px card. The worst
 * instance read as an outright layout bug.
 *
 * Prose scope and page geometry are two different jobs. This holds them apart.
 */
const appCssSource = readFileSync('src/ui/assets/app.css', 'utf8');
const viewerCssSource = readClientSource('viewer.css');
const viewerPage = readFileSync('src/ui/pages/viewer.tsx', 'utf8');
const viewerScript = readClientSource('viewer.js');

const appRules = parseStylesheet(appCssSource);
const documentRules = [
  ...appRules,
  ...parseStylesheet(viewerCssSource, (appRules.at(-1)?.order ?? 0) + 1),
];

/** Rendered markdown inside a dashboard preview card. */
const embeddedProse: ElementSpec[] = [
  { tag: 'section', classes: ['aa-card'] },
  { tag: 'div', classes: ['aa-card__body'] },
  { tag: 'div', attributes: { 'data-aa-dashboard-preview': 'markdown' } },
  { tag: 'article', classes: ['aa-md'] },
];

/** The same rendered markdown read on its own on the public viewer. */
const standaloneProse: ElementSpec[] = [
  { tag: 'main', classes: ['aa-viewer'] },
  { tag: 'section', classes: ['aa-viewer-content'] },
  { tag: 'div', classes: ['aa-prose-page'] },
  { tag: 'article', classes: ['aa-md'] },
];

describe('markdown prose scope', () => {
  it('carries no page geometry into a card', () => {
    for (const property of ['margin', 'margin-top', 'width', 'padding', 'padding-inline']) {
      for (const viewportWidth of [375, 1440]) {
        expect(
          winningDeclaration(documentRules, embeddedProse, property, viewportWidth)?.value,
          `${property} on embedded prose at ${viewportWidth}px`
        ).toBeUndefined();
      }
    }
  });

  it('still styles the prose itself wherever it is embedded', () => {
    expect(
      winningDeclaration(documentRules, embeddedProse, 'font-size', 1440)?.value
    ).toBeDefined();
    expect(
      winningDeclaration(documentRules, embeddedProse, 'line-height', 1440)?.value
    ).toBeDefined();
  });

  it('never opens an embedded preview with a phantom heading margin', () => {
    // The dashboard renders previews at headingOffset 1, so the first element is usually an <h2>,
    // and `.aa-md h2 { margin: 2em 0 0.6em }` put 2em of nothing at the top of every preview card.
    const firstHeading: ElementSpec[] = [
      ...embeddedProse,
      { tag: 'h2', attributes: { 'data-first': 'true' } },
    ];

    const rule = appRules.find((candidate) =>
      /\.aa-md\s*>\s*:first-child/.test(candidate.selector)
    );
    expect(rule, 'no first-child margin reset on .aa-md').toBeDefined();
    expect(declarationValue(rule?.block ?? '', 'margin-top')).toBe('0');
    expect(firstHeading).toBeDefined();
  });

  it('keeps the reading column for prose read on its own', () => {
    const width = winningDeclaration(documentRules, standaloneProse.slice(0, 3), 'width', 1440);
    expect(width?.value).toContain('var(--width-aa-prose)');

    const margin = winningDeclaration(
      documentRules,
      standaloneProse.slice(0, 3),
      'margin-inline',
      1440
    );
    expect(margin?.value).toBe('auto');
    expect(
      winningDeclaration(documentRules, standaloneProse.slice(0, 3), 'padding', 1440)
    ).toBeDefined();
  });

  it('tightens the reading column padding on a phone', () => {
    const wide = winningDeclaration(
      documentRules,
      standaloneProse.slice(0, 3),
      'padding-inline',
      1440
    );
    const narrow = winningDeclaration(
      documentRules,
      standaloneProse.slice(0, 3),
      'padding-inline',
      375
    );

    expect(narrow?.value).toBe('var(--spacing-aa-4)');
    expect(narrow?.value).not.toBe(wide?.value ?? null);
  });

  it('renders the same prose container on the server and in the viewer script', () => {
    // The server wrapped markdown in a bare <div> and the client assigned innerHTML straight onto
    // the content section, so the two produced different DOM for the same artifact.
    expect(viewerPage).toContain('aa-prose-page');
    expect(viewerScript).toContain('aa-prose-page');
  });
});

describe('embedded preview frames', () => {
  it('gives a framed preview a real box instead of the UA 300x150 default', () => {
    const previewFrame: ElementSpec[] = [
      { tag: 'section', classes: ['aa-card'] },
      { tag: 'div', classes: ['aa-card__body'] },
      { tag: 'iframe' },
    ];

    expect(winningDeclaration(appRules, previewFrame, 'width', 1440)?.value).toBe('100%');
    expect(winningDeclaration(appRules, previewFrame, 'height', 1440)?.value).toBeDefined();
    expect(winningDeclaration(appRules, previewFrame, 'border', 1440)?.value).toBe('0');
    // And the same box is available by name, so a page can opt in outside a card body.
    expect(appRules.some((rule) => rule.selector.includes('.aa-preview-frame'))).toBe(true);
  });
});
