import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import {
  declarationValue,
  maxLength,
  parseStylesheet,
  ROOT_FONT_SIZE,
  resolveVars,
  splitTopLevel,
  stripComments,
  themeVariables,
  winningDeclaration,
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

  it('sets no font-size below the legibility floor', () => {
    // V6-N2: `.aa-marketing-api__label` shipped at 0.72rem — 11.52px — on a label that is also
    // uppercase, letterspaced and muted on a dark card. One value, one screen, and found only
    // because a validator measured every label on the page.
    //
    // A walk rather than a fix to that one rule, for the usual reason: the next sub-12px value will
    // be somewhere nobody is measuring. 12px is the floor the hunt pre-registered, and
    // `--text-aa-xs` is exactly 12px — so the scale's own smallest step is the floor, and anything
    // under it is off the scale as well as under the floor. The two were the same edit here.
    //
    // Stated limits, because this resolves values rather than rendering them: `em` and `%` depend
    // on a parent this cannot know, and `inherit` says nothing, so those are skipped. `clamp()` is
    // read at its FIRST argument — the smallest it can compute to — because a floor cares about the
    // worst case, not the comfortable one.
    const css = stripComments(readFileSync('src/ui/assets/app.css', 'utf8'));
    const variables = themeVariables(css);
    const FLOOR_PX = 12;
    let checked = 0;

    for (const rule of parseStylesheet(css)) {
      const declared = declarationValue(rule.block, 'font-size');
      if (!declared) {
        continue;
      }

      const resolved = resolveVars(declared, variables).trim();
      if (/em\b|%|inherit/.test(resolved.replace(/rem\b/g, ''))) {
        continue;
      }

      const smallest = resolved.startsWith('clamp(')
        ? (splitTopLevel(resolved.slice(6, -1))[0] ?? '').trim()
        : resolved;
      const px = /rem$/.test(smallest)
        ? Number.parseFloat(smallest) * ROOT_FONT_SIZE
        : /px$/.test(smallest)
          ? Number.parseFloat(smallest)
          : Number.NaN;
      if (Number.isNaN(px)) {
        continue;
      }

      checked += 1;
      expect(
        px,
        `${rule.selector} sets font-size ${declared} (${px}px), under the ${FLOOR_PX}px floor`
      ).toBeGreaterThanOrEqual(FLOOR_PX);
    }

    // Vacuity guard: if the resolution stops working, every size skips and this passes for free.
    expect(checked, 'no font-size resolved — the walk is measuring nothing').toBeGreaterThan(40);
  });

  it('gives a standalone link a target big enough to hit', () => {
    // V6-N3, and the rule it settles. A CONTROL takes `--spacing-aa-touch` (44px, this product's
    // own floor). A TEXT LINK takes 24px, WCAG 2.5.8's minimum — not 44, because a row of tertiary
    // links at 44px each becomes a band of empty space under every page.
    //
    // 2.5.8 exempts links inside a sentence, where line-height sets the size. The marketing footer
    // is not a sentence — it is a row of links separated by glyphs — so the exemption does not
    // apply and the minimum does. They were 23.80px, missing by a fifth of a pixel, because the
    // height was pure `line-height` arithmetic with no padding: nothing declared the size, so
    // nothing protected it.
    //
    // Asserted on the declaration rather than by rendering, so it fails when someone removes the
    // rule. The measured result is in the commit; a resolver cannot see a rendered box.
    const declared = winningDeclaration(
      parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8')),
      [{ tag: 'p', classes: ['aa-marketing-footer__links'] }, { tag: 'a' }],
      'min-height',
      1440
    )?.value;

    expect(declared, 'the footer links declare no minimum target size').toBeDefined();
    expect(
      Number.parseFloat(String(declared)) * (String(declared).endsWith('rem') ? ROOT_FONT_SIZE : 1),
      `standalone footer links are ${declared}, under WCAG 2.5.8's 24px minimum`
    ).toBeGreaterThanOrEqual(24);
  });

  it('spends spacing from the scale, not from a literal that happens to look right', () => {
    // V7-N1. The marketing surfaces carried nineteen container dimensions in raw rem — 1.125rem,
    // 1.05rem, 0.8rem, a hero clamp topping out at an off-scale 42px — in a stylesheet whose own
    // doctrine says a raw literal in a container dimension is a bug. Twenty-nine distinct values
    // across nineteen declarations, with no common divisor: that is not a rhythm, it is nudging.
    //
    // Snapped rather than exempted, and the choice was measured rather than argued: every value
    // moved by 0.8-4.8px and the whole page lost 22px of 3758 (0.6%) with nothing else changing.
    // A "fluid marketing rhythm" exemption would have been a story about values nobody could
    // defend individually.
    //
    // The walk covers the WHOLE stylesheet, not the surfaces that were reported. That is what
    // found `.aa-badge--md` at 0.625rem/10px — a product surface, inside the scale's range,
    // between two of its steps, which the filed row did not mention.
    //
    // TWO ARGUED CATEGORIES, and they are categories rather than a list of names: a literal is
    // allowed only where the scale CANNOT express the value — below its 4px floor (optical insets
    // against a radius, icon alignment: spacing the eye reads, not rhythm the layout keeps) or
    // above its 64px ceiling (marketing section rhythm, which needs roughly double the top step).
    // Anything BETWEEN two steps is drift by definition, because the scale has a step for it.
    const css = stripComments(readFileSync('src/ui/assets/app.css', 'utf8'));
    const steps = Array.from(css.matchAll(/^\s*--spacing-aa-\d+:\s*([\d.]+)rem;/gm), (match) =>
      Number.parseFloat(String(match[1]))
    );
    expect(steps.length, 'the spacing scale did not parse').toBeGreaterThan(5);
    const floor = Math.min(...steps);
    const ceiling = Math.max(...steps);

    const CONTAINER =
      /\b(gap|row-gap|column-gap|padding|padding-block|padding-inline|padding-top|padding-bottom|padding-left|padding-right|margin|margin-top|margin-bottom)\s*:\s*([^;]+);/g;
    const drift: string[] = [];
    let checked = 0;

    for (const rule of parseStylesheet(css)) {
      for (const declaration of rule.block.matchAll(CONTAINER)) {
        checked += 1;
        for (const literal of String(declaration[2]).matchAll(/(?<![\w-])(\d*\.?\d+)rem/g)) {
          const value = Number.parseFloat(String(literal[1]));
          if (steps.includes(value) || value < floor || value > ceiling) {
            continue;
          }
          drift.push(`${rule.selector} { ${declaration[1]}: … ${value}rem/${value * 16}px … }`);
        }
      }
    }

    expect(
      checked,
      'no container dimensions parsed — the walk is measuring nothing'
    ).toBeGreaterThan(80);
    expect(
      [...new Set(drift)],
      'these sit between two steps of the scale, so the scale has a value for them and this one ' +
        'was chosen by eye. Take the token. A literal is only defensible where the scale cannot ' +
        'reach — under its floor or over its ceiling — and both of those are stated at the rule.'
    ).toEqual([]);
  });

  it('sets every static type size from the scale too, not only the fluid ones', () => {
    // V9-N1, and the finding my own guard's frame could not see. The clamp walk audited a
    // MECHANISM — fluid sizes — and drift lives just as happily in values that never engaged it.
    // Two static literals blocked the D1 yield, and walking the PROPERTY instead of the mechanism
    // found nine: four different mono sizes between 13.12px and 13.5px, three labels at 12.48px,
    // a caption 0.28px off a token. All between steps, so all drift by the spacing doctrine.
    //
    // Two of them are product surfaces the row did not name — `.aa-copy pre` and `.aa-md pre`,
    // which reaches the viewer. The reported surface is not the walk's boundary; it was not last
    // round either, and this is the second guard of mine whose frame was narrower than its subject.
    //
    // ONE literal survives, and NOT under the above-the-ceiling category even though it qualifies
    // numerically. See the rule: it is an `aria-hidden` glyph used as a drawing, so it is not type
    // at all — and the exemption is granted by CHECKING that, below, rather than by naming it.
    const css = stripComments(readFileSync('src/ui/assets/app.css', 'utf8'));
    const tokens = new Set(
      Array.from(css.matchAll(/^\s*--text-aa-[\w]+:\s*([\d.]+)rem;/gm), (match) =>
        Number.parseFloat(String(match[1]))
      )
    );
    expect(tokens.size, 'the type scale did not parse').toBeGreaterThan(5);

    const marketingSource = readFileSync('src/ui/components/marketing.tsx', 'utf8');
    const drift: string[] = [];
    let sizes = 0;

    for (const rule of parseStylesheet(css)) {
      const declared = declarationValue(rule.block, 'font-size');
      if (!declared || declared.includes('clamp(')) {
        continue;
      }
      sizes += 1;
      for (const literal of declared.matchAll(/(?<![\w-])(\d*\.?\d+)rem/g)) {
        const value = Number.parseFloat(String(literal[1]));
        if (tokens.has(value)) {
          continue;
        }
        // The only exemption: a class whose element is aria-hidden where it is rendered. That is a
        // glyph used as a drawing, and a ladder of reading sizes has no opinion about it. Evaluated
        // from the component source, so making the element readable removes the licence.
        const className = /\.([\w-]+)\s*$/.exec(rule.selector)?.[1];
        const ornament =
          className &&
          new RegExp(`class="${className}"[^>]*aria-hidden="true"`).test(marketingSource);
        if (ornament) {
          continue;
        }
        drift.push(`${rule.selector} { font-size: ${declared} }`);
      }
    }

    expect(sizes, 'no static font sizes parsed — the walk is measuring nothing').toBeGreaterThan(
      20
    );
    expect(
      drift,
      'these static sizes sit off the type scale. Take the token — a size that is not fluid is ' +
        'not exempt from the ladder just because nothing interpolates it.'
    ).toEqual([]);
  });

  it('sets type from the scale, including at the ends of a fluid clamp', () => {
    // V3 dismissed these in r6 by judgment, and said so: a judged dismissal is not "found none",
    // so it came back every pass. This makes it a stated rule instead.
    //
    // A clamp's ENDPOINTS are not incidental — they are the sizes actually rendered at the narrow
    // and wide ends, because the vw term is outside the clamp range at both real viewports. So they
    // are judged exactly like a static value, and an exception for a fluid ramp is not an exception
    // for both of its ends.
    //
    // Measured before deciding, per the spacing precedent: of sixteen endpoints across eight
    // clamps, thirteen sat 0.20-4.40px from an existing token, and the four display clamps grew at
    // four different ratios (1.25, 1.50, 1.30, 1.39). Four independent guesses is not a display
    // scale, so there was no intent to exempt — they are tokens now, and the rendered ladder is the
    // scale's own steps: 17 / 20 / 24 / 30 / 40 / 54.
    //
    // ONE literal survives, and by the same category the spacing walk uses: above the ceiling. The
    // marketing headline's 54px maximum is past `--text-aa-hero`/40px, the top of a ladder built
    // for product UI, and a token used once is a step no component reaches for. Its MINIMUM is a
    // token — only the growth is exempt.
    const css = stripComments(readFileSync('src/ui/assets/app.css', 'utf8'));
    const ceiling = Math.max(
      ...Array.from(css.matchAll(/^\s*--text-aa-[\w]+:\s*([\d.]+)rem;/gm), (match) =>
        Number.parseFloat(String(match[1]))
      )
    );
    expect(ceiling, 'the type scale did not parse').toBeGreaterThan(1);

    const offScale: string[] = [];
    let endpoints = 0;

    for (const rule of parseStylesheet(css)) {
      const declared = declarationValue(rule.block, 'font-size');
      if (!declared?.startsWith('clamp(')) {
        continue;
      }
      const parts = splitTopLevel(declared.slice(6, -1)).map((part) => part.trim());
      // First and last: the minimum and the maximum. The middle term is the viewport ramp.
      for (const end of [parts[0], parts.at(-1)]) {
        endpoints += 1;
        if (!end || end.startsWith('var(')) {
          continue;
        }
        const rem = Number.parseFloat(end);
        if (/rem$/.test(end) && rem > ceiling) {
          continue; // above the ceiling — the stated category, argued at the rule
        }
        offScale.push(`${rule.selector} { font-size: clamp(… ${end} …) }`);
      }
    }

    expect(endpoints, 'no clamp endpoints parsed — the walk is measuring nothing').toBeGreaterThan(
      10
    );
    expect(
      offScale,
      'these clamp endpoints are literals the type scale has a token for. A fluid size still ' +
        'renders a real size at each end; take the token, or — only above the scale’s ceiling — ' +
        'state at the rule why the scale cannot reach it.'
    ).toEqual([]);
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
