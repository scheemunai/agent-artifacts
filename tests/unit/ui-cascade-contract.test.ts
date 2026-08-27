import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState } from '../../src/ui/components/primitives.js';
import {
  declarationValue,
  type ElementSpec,
  inheritedValue,
  maxLength,
  parseStylesheet,
  resolveVars,
  specificity,
  splitTopLevel,
  stripComments,
  themeVariables,
  winningDeclaration,
} from '../support/css-cascade.js';

/**
 * The Fresh Air foundation is authored as one stylesheet plus a viewer overlay, so several of its
 * worst defects are not visible in any single declaration — they are cascade and geometry
 * accidents that only show up once you resolve a rule the way a browser does. These tests resolve
 * them: matching, specificity, source order, media queries, and inheritance.
 */
const appCssSource = readFileSync('src/ui/assets/app.css', 'utf8');
const viewerCssSource = readFileSync('public/assets/viewer-4fd0df5f2b2a.css', 'utf8');
const viewerScript = readFileSync('public/assets/viewer-0f4f9f6c8a7e.js', 'utf8');

const appCss = stripComments(appCssSource);
const variables = themeVariables(appCssSource);

const appRules = parseStylesheet(appCssSource);
/** The viewer document links app.css first, then the viewer sheet, so order continues. */
const documentRules = [
  ...appRules,
  ...parseStylesheet(viewerCssSource, (appRules.at(-1)?.order ?? 0) + 1),
];

function escapeSelector(selector: string): string {
  return selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Body of the first `selector { … }` rule. Selectors in this sheet never nest braces. */
function ruleBlock(css: string, selector: string): string {
  const match = new RegExp(`(?:^|[};])\\s*${escapeSelector(selector)}\\s*\\{([^}]*)\\}`, 'm').exec(
    css
  );
  if (!match?.[1]) {
    throw new Error(`no rule found for selector ${selector}`);
  }
  return match[1];
}

/** Splits a grid track list on top-level whitespace: `minmax(0, 80vw) 1fr` is two tracks. */
function splitTracks(value: string): string[] {
  return splitTopLevel(value.replace(/\s+/g, ' '), ' ');
}

describe('overlay geometry', () => {
  it('re-centres modal dialogs that the Tailwind preflight un-centres', () => {
    // Preflight emits `*,::backdrop{margin:0}`, which overrides the UA sheet's `dialog{margin:auto}`.
    // Without an explicit re-declaration every showModal() dialog paints at the viewport's 0,0.
    const dialog = ruleBlock(appCss, '.aa-dialog');

    expect(declarationValue(dialog, 'margin')).toBe('auto');
  });

  it('keeps the drawer scrim covering every pixel the panel does not', () => {
    const drawer = ruleBlock(appCss, '.aa-drawer');
    const panel = ruleBlock(appCss, '.aa-drawer__panel');

    const tracks = splitTracks(
      resolveVars(declarationValue(drawer, 'grid-template-columns') ?? '', variables)
    );
    expect(tracks).toHaveLength(2);

    const panelMaxWidth = maxLength(
      resolveVars(declarationValue(panel, 'max-width') ?? '', variables),
      0
    );
    const panelTrack = tracks[0] as string;

    // `role="dialog" aria-modal="true"` is a lie for every pixel of page that is left undimmed and
    // still clickable, so the panel's grid track must never be wider than the panel it paints.
    for (const viewportWidth of [375, 480, 768, 1024, 1440, 1920]) {
      expect(
        maxLength(panelTrack, viewportWidth),
        `panel track at ${viewportWidth}px`
      ).toBeLessThanOrEqual(panelMaxWidth);
    }
  });
});

describe('cascade repairs', () => {
  const menuTrigger: ElementSpec[] = [
    { tag: 'header', classes: ['aa-app-header'] },
    { tag: 'div', classes: ['aa-shell', 'aa-app-nav'] },
    { tag: 'button', classes: ['aa-btn', 'aa-btn--ghost', 'aa-mobile-trigger'] },
  ];

  it('hides the mobile menu trigger on desktop and keeps it on phones', () => {
    // `.aa-mobile-trigger { display: none }` and `.aa-btn { display: inline-flex }` are both
    // (0,1,0). Source order decides, and `.aa-btn` is emitted later — so a bare hide rule loses and
    // the Menu button renders next to the full desktop nav on every page at 1440.
    expect(winningDeclaration(appRules, menuTrigger, 'display', 1440)?.value).toBe('none');
    expect(winningDeclaration(appRules, menuTrigger, 'display', 375)?.value).toBe('inline-flex');
  });

  it('never lets a button rule depend on source order to beat the base rule', () => {
    // Named trap, two instances: `.aa-mobile-trigger` shipped broken for months, and
    // `.aa-btn--compact-hide` was laid again while this batch was in flight. Both are (0,1,0)
    // against `.aa-btn { display: inline-flex }`, so whichever is emitted later wins — which means
    // the product is one file reorder away from the same defect. Equal specificity is the bug;
    // resolving correctly today is not a defence.
    const base = appRules.find((rule) => rule.selector === '.aa-btn');
    const baseDisplay = declarationValue(base?.block ?? '', 'display');
    const baseSpecificity = specificity('.aa-btn');

    const buttonRules = appRules.filter((rule) => {
      if (rule.selector === '.aa-btn') {
        return false;
      }
      // Single compound only: a rule that already has an ancestor is not in this tie.
      if (/[\s>+~]/.test(rule.selector.trim())) {
        return false;
      }
      if (!/\.aa-btn|\.aa-mobile-trigger/.test(rule.selector)) {
        return false;
      }
      const display = declarationValue(rule.block, 'display');
      // A rule that sets the same display as the base cannot lose anything to it.
      return display !== undefined && display !== baseDisplay;
    });

    expect(buttonRules.length, 'no button display rules found — check the filter').toBeGreaterThan(
      0
    );

    for (const rule of buttonRules) {
      const ruleSpecificity = specificity(rule.selector);
      const beatsBase =
        ruleSpecificity[0] > baseSpecificity[0] ||
        (ruleSpecificity[0] === baseSpecificity[0] && ruleSpecificity[1] > baseSpecificity[1]) ||
        (ruleSpecificity[0] === baseSpecificity[0] &&
          ruleSpecificity[1] === baseSpecificity[1] &&
          ruleSpecificity[2] > baseSpecificity[2]);

      expect(
        beatsBase,
        `"${rule.selector}" sets display:${declarationValue(rule.block, 'display')} at the same ` +
          `specificity as ".aa-btn" — it wins only because of where it sits in the file. ` +
          `Qualify it as ".aa-btn${rule.selector}".`
      ).toBe(true);
    }
  });

  const passwordGateError: ElementSpec[] = [
    { tag: 'section', classes: ['aa-viewer-gate'] },
    { tag: 'div', classes: ['aa-viewer-gate-card'] },
    { tag: 'form', classes: ['aa-viewer-password-form'] },
    { tag: 'p', classes: ['aa-error'] },
  ];

  const terminalCardCopy: ElementSpec[] = [
    { tag: 'main', classes: ['aa-viewer-terminal'] },
    { tag: 'section', classes: ['aa-viewer-terminal-card'] },
    { tag: 'p' },
  ];

  it('paints the public password gate failure in danger, not helper-text grey', () => {
    // `.aa-viewer-gate-card p` is (0,1,1) and outranks `.aa-error` (0,1,0) at any source order, so
    // the single most security-relevant public error rendered as muted grey helper text.
    for (const viewportWidth of [375, 1440]) {
      expect(
        inheritedValue(documentRules, passwordGateError, 'color', viewportWidth),
        `gate error colour at ${viewportWidth}px`
      ).toBe('var(--color-aa-danger)');
    }
  });

  it('keeps the muted tone on ordinary gate and terminal copy', () => {
    expect(inheritedValue(documentRules, terminalCardCopy, 'color', 1440)).toBe(
      'var(--color-aa-muted)'
    );
  });

  it('marks the password field invalid and reserves the error line so the button cannot jump', () => {
    expect(viewerScript).toContain("setAttribute('aria-invalid', 'true')");
    expect(
      declarationValue(ruleBlock(viewerCssSource, '.aa-viewer-password-error'), 'min-height')
    ).toBeDefined();
  });

  const installPromptLine: ElementSpec[] = [
    { tag: 'section', classes: ['aa-empty'] },
    { tag: 'div', classes: ['aa-empty__action'] },
    { tag: 'section', classes: ['aa-copy'] },
    { tag: 'pre' },
  ];

  const emptyStateTitle: ElementSpec[] = [
    { tag: 'section', classes: ['aa-empty'] },
    { tag: 'h3', classes: ['aa-empty__title'] },
  ];

  it('stops the empty state centring preformatted text in its action slot', () => {
    // `.aa-empty { text-align: center }` inherits all the way into a CopyBlock's <pre>, so the
    // first-run install prompt renders as centre-aligned monospace, line by line.
    expect(inheritedValue(appRules, installPromptLine, 'text-align', 375, 'start')).toBe('start');
    expect(inheritedValue(appRules, emptyStateTitle, 'text-align', 375, 'start')).toBe('center');
  });

  it('gives the empty state action slot a class the stylesheet can target', () => {
    const html = renderToString(
      EmptyState({
        title: 'No artifacts yet',
        description: 'Paste the install prompt into your agent.',
        action: 'Register a bot',
      })
    );

    expect(html).toContain('aa-empty__action');
  });
});
