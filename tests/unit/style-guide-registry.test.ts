import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
 * `.aa-specimen-row` — a class named after the style guide — leaked into 25 production call sites.
 * The migration is now complete, so this walks every source file rather than an enumerated list of
 * the ones a batch happened to own.
 *
 * The enumeration was the right shape while the migration was in flight and the wrong shape the
 * moment it finished: a list guards the files someone remembered to list, and the whole point of
 * this class of defect is that it spreads to files nobody is thinking about. Seven names became
 * sixty-eight files the day the alias came out.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.(tsx?|js)$/.test(entry.name) ? [path] : [];
  });
}

const ALL_SOURCES = [...sourceFiles('src'), ...sourceFiles('public/assets')];

function exportedComponents(source: string): string[] {
  return Array.from(source.matchAll(/^export function ([A-Z][A-Za-z0-9]*)\s*\(/gm), (match) =>
    String(match[1])
  );
}

describe('style guide registry', () => {
  it('registers every exported primitive as a rendered element, not a mention', () => {
    // This accepted `Name(` or `<Name` anywhere in the file, comments included — so a primitive
    // named only in the prose explaining why it exists counted as registered. The guide's whole
    // claim is that it *shows* the components, so the match now requires JSX element syntax in
    // code with comments stripped.
    //
    // Honest limit, stated rather than implied: this proves the guide renders the element, not
    // that the specimen exercises it meaningfully. A rendered marker per primitive would need a
    // per-specimen wrapper the guide does not currently have.
    const code = styleGuideSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    const components = exportedComponents(primitivesSource);
    expect(components.length).toBeGreaterThan(15);

    for (const name of components) {
      const rendered = new RegExp(`<${name}[\\s/>]`).test(code);
      expect(rendered, `${name} is exported but never rendered in the style guide`).toBe(true);
    }
  });

  it('shows specimen data as a shape, never as a plausible fact', () => {
    // D5-4: the marketing specimen hard-coded "updated 6 h ago" — the exact string W5 deleted from
    // the home page for asserting a freshness nobody had computed. In the design contract it is
    // worse than on home: it is the version other people copy.
    expect(html, 'the guide states a relative time as if it were real').not.toMatch(
      /\b\d+\s*(?:h|hrs?|hours?|m|mins?|minutes?|d|days?)\s+ago\b/i
    );
  });

  it('describes the surfaces that are whole documents rather than primitives', () => {
    // These cannot be rendered inline — they replace the page — so the guide names them and says
    // where they are used, rather than pretending they do not exist.
    for (const name of ['FrameDocument', 'FrameTerminalDocument', 'ErrorPage', 'VersionBanner']) {
      expect(html, `${name} is missing from the design contract`).toContain(name);
    }
  });

  it('ships the style guide class from nowhere in the product', () => {
    expect(ALL_SOURCES.length).toBeGreaterThan(50);

    for (const path of ALL_SOURCES) {
      // Applied as a class, not merely named in the prose that explains why it was deprecated.
      expect(
        readFileSync(path, 'utf8'),
        `${path} still hand-rolls a row with the style-guide class`
      ).not.toMatch(/class(?:Name)?=["'][^"']*aa-specimen-row/);
    }
  });

  it('retires the deprecated alias now that nothing calls it', () => {
    // The alias existed for one reason — 25 production call sites could not be migrated in one
    // commit — and that reason is now spent. It is deleted rather than left defined-but-unused,
    // because an available class is an invitation: the next person to need a row finds it by
    // autocomplete and the leak restarts, which is exactly how it reached 25 sites the first time.
    //
    // This assertion is the inverse of the one it replaces. That is deliberate: a scaffold removed
    // with no test is a scaffold that can come back silently, so the retirement is pinned in the
    // same place the exception used to be, and the CSS is read rather than the compiled output so
    // the guard holds without a build.
    const css = readFileSync('src/ui/assets/app.css', 'utf8');
    expect(css).not.toMatch(/\.aa-specimen-row\s*[,{]/);
    // ButtonRow's own class is what survives, and it must survive — the alias shared its block.
    expect(css).toMatch(/\.aa-button-row\s*\{/);
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
      // Input.autocomplete — the browser vocabulary that tells three identical-looking password
      // boxes apart. It shipped with a consumer and no specimen, which is how a prop becomes
      // invisible: the next author writes the form without it because the contract never showed it.
      'autocomplete="current-password"',
      'autocomplete="new-password"',
      // Input.required — the platform constraint, registered so a consumer can see it exists
      // rather than re-deriving a script guard for want of a declarative one.
      'required',
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

  it('registers both of the ways Pagination can be driven', () => {
    // `previousHref` / `nextHref` shipped with a first consumer and no specimen, so the contract
    // showed a component that could only be driven by a client nobody had written — while the
    // artifact list footer, the reason the props exist, was invisible here.
    //
    // Scoped to the pagination specimens rather than the whole page: buttons and links both appear
    // all over this document, so a page-wide match would pass on any two unrelated elements.
    const navs = html.match(/<nav class="aa-pagination"[\s\S]*?<\/nav>/g) ?? [];
    expect(navs.length, 'pagination has no specimens').toBeGreaterThan(1);

    expect(
      navs.some((nav) => /<button[^>]*>\s*<span>Next<\/span>/.test(nav)),
      'no script-driven pagination specimen'
    ).toBe(true);
    expect(
      navs.some((nav) => /<a[^>]*\shref="[^"]+"[^>]*>\s*<span>Next<\/span>/.test(nav)),
      'the href-driven mode has no specimen'
    ).toBe(true);
  });

  it('shows what a paging step disabled on the first page renders as', () => {
    // A step that is given an href and disabled at once — the first page of any cursor list — is
    // the shape most likely to be got wrong. It keeps its element and loses its destination, so
    // the tag does not change between pages and the focus order does not shift under the reader.
    // The lookahead is the assertion that matters: a disabled step with an href would be a live
    // link dressed as an unavailable one.
    expect(html, 'no specimen for a disabled link-driven step').toMatch(
      /<a(?![^>]*\shref=)[^>]*aria-disabled="true"[^>]*tabindex="-1"[^>]*>\s*<span>Previous<\/span>/
    );
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
