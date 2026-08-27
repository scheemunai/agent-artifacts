import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import {
  declarationValue,
  maxLength,
  parseStylesheet,
  resolveVars,
  stripComments,
  themeVariables,
} from '../support/css-cascade.js';

/**
 * The style guide calls itself "the design contract for Agent Artifacts". A contract that omits
 * half the components, or that demonstrates a class production is not allowed to use, is worse
 * than no contract — it is a document people trust and should not.
 *
 * So: every exported primitive is registered, every document-level surface is described, and the
 * guide itself uses the primitives it documents rather than the hand-rolled shapes it caused.
 */
const primitivesSource = readFileSync('src/ui/components/primitives.tsx', 'utf8');
const styleGuideSource = readFileSync('src/ui/pages/style-guide.tsx', 'utf8');
const html = renderToString(StyleGuidePage());

/**
 * Files this batch owns. `.aa-specimen-row` — a class named after the style guide — leaked into 25
 * production call sites; these are the ones retired here, with the rest tracked for the
 * page-adoption phase.
 */
const OWNED_SOURCES = [
  'src/ui/components/primitives.tsx',
  'src/ui/components/version-banner.tsx',
  'src/ui/pages/style-guide.tsx',
  'src/ui/pages/viewer.tsx',
  'src/ui/pages/share-terminal.tsx',
  'src/ui/pages/error-page.tsx',
  'public/assets/viewer-0f4f9f6c8a7e.js',
];

function exportedComponents(source: string): string[] {
  return Array.from(source.matchAll(/^export function ([A-Z][A-Za-z0-9]*)\s*\(/gm), (match) =>
    String(match[1])
  );
}

describe('style guide registry', () => {
  it('registers every exported primitive', () => {
    const components = exportedComponents(primitivesSource);
    expect(components.length).toBeGreaterThan(15);

    for (const name of components) {
      const used = new RegExp(`(?:<${name}[\\s/>]|\\b${name}\\()`).test(styleGuideSource);
      expect(used, `${name} is exported but never registered in the style guide`).toBe(true);
    }
  });

  it('describes the surfaces that are whole documents rather than primitives', () => {
    // These cannot be rendered inline — they replace the page — so the guide names them and says
    // where they are used, rather than pretending they do not exist.
    for (const name of ['FrameDocument', 'FrameTerminalDocument', 'ErrorPage', 'VersionBanner']) {
      expect(html, `${name} is missing from the design contract`).toContain(name);
    }
  });

  it('stops shipping the style guide class into the product', () => {
    for (const path of OWNED_SOURCES) {
      // Applied as a class, not merely named in the prose that explains why it is deprecated.
      expect(
        readFileSync(path, 'utf8'),
        `${path} still hand-rolls a row with the style-guide class`
      ).not.toMatch(/class(?:Name)?=["'][^"']*aa-specimen-row/);
    }
  });

  it('keeps the deprecated alias defined until the remaining pages migrate', () => {
    // The class is still on home, login, setup, placeholder and dashboard. Deleting the rule now
    // would break those pages; sharing one declaration block means it cannot drift meanwhile.
    const css = readFileSync('src/ui/assets/app.css', 'utf8');
    expect(css).toMatch(/\.aa-button-row,\s*\n\s*\.aa-specimen-row\s*\{/);
  });

  it('documents every state of the primitives it registers', () => {
    for (const marker of [
      // Button: four variants x six states.
      'data-aa-state="hover"',
      'data-aa-state="active"',
      'data-aa-state="disabled"',
      'aria-busy="true"',
      // Input: default, hint, error, disabled, focus.
      'aria-invalid="true"',
      // Notice: four tones.
      'aa-notice--info',
      'aa-notice--success',
      'aa-notice--warn',
      'aa-notice--danger',
      // ButtonRow: four alignments plus full-width buttons.
      'aa-button-row--center',
      'aa-button-row--end',
      'aa-button-row--between',
      'aa-btn--full',
      // Table: default plus column priority.
      'aa-table-scroll--priority',
      // Pagination: enabled and disabled.
      'aa-pagination',
    ]) {
      expect(html, `${marker} has no specimen`).toContain(marker);
    }
  });

  it('declares no min-width a 375px viewport cannot hold, outside a scroll container', () => {
    // 375 minus the shell's two 16px insets. Anything wider than this that is not a table — and
    // every table in this sheet lives inside `.aa-table-scroll` — would push the page sideways.
    const contentBox = 375 - 2 * 16;
    const css = stripComments(readFileSync('src/ui/assets/app.css', 'utf8'));

    for (const rule of parseStylesheet(css)) {
      const declared = declarationValue(rule.block, 'min-width');
      // Percentages and intrinsic keywords resolve against the parent, so they cannot force a
      // page wider than its container.
      if (
        !declared ||
        declared === '0' ||
        /%|max-content|min-content|fit-content|auto/.test(declared)
      ) {
        continue;
      }

      const width = maxLength(resolveVars(declared, themeVariables(css)), 375);
      if (width <= contentBox) {
        continue;
      }
      expect(
        /(?:^|[\s.])table$|\.aa-table$/.test(rule.selector),
        `${rule.selector} sets min-width ${declared} and is not a scroll-contained table`
      ).toBe(true);
    }
  });

  it('renders no duplicate id anywhere in the design contract', () => {
    // A necessary check, but NOT the one that catches the class — see the note in
    // `tests/unit/ui-duplicate-ids.test.ts`. This guard only sees what the guide happens to render,
    // and the guide is written by the same hands as the components, with the same blind spots.
    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => String(match[1]));
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

    expect(duplicates, `duplicate ids: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('has exactly one h1 and no inline executable script', () => {
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[\s\S]*?>[\s\S]*?<\/script>/i);
  });
});
