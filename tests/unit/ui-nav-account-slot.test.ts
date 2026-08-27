import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { NavShell } from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import { type ElementSpec, parseStylesheet, winningDeclaration } from '../support/css-cascade.js';

/**
 * Identity has to be somewhere at every width, and the header is the one row a phone cannot spare.
 * So `NavShell` mounts the `account` slot twice — header and drawer footer — and the breakpoint
 * decides which one is live.
 *
 * That is a dangerous shape written by hand, and it has already gone wrong once: 122c3c5 fixed a
 * dashboard that mounted the block in two places itself, so at 375px with the drawer open BOTH
 * were live. The fix is not "remember to mount it once" — it is that the component owns both
 * mounts and the invariant, and callers pass one prop. These tests hold that bargain from both
 * ends: the markup really does render twice, and the stylesheet really does leave exactly one of
 * them visible at each width.
 */
const rules = parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8'));

const ACCOUNT = 'ops-bot@example.com';
const ITEMS = [{ label: 'Artifacts', href: '/dashboard', current: true }];

function shell(props: Parameters<typeof NavShell>[0]): string {
  return renderToString(NavShell(props));
}

const headerAccount: ElementSpec[] = [
  { tag: 'header', classes: ['aa-app-header'] },
  { tag: 'div', classes: ['aa-shell', 'aa-app-nav'] },
  { tag: 'div', classes: ['aa-app-nav__account'] },
];

describe('NavShell account slot', () => {
  it('renders nothing at all when no account is passed', () => {
    // Every page that is not signed in uses this shell too. An empty container in the header is a
    // gap that reads as something that failed to load.
    const html = shell({ items: ITEMS });

    expect(html).not.toContain('aa-app-nav__account');
    expect(html, 'an empty drawer footer is a 1px rule under the last nav link').not.toContain(
      'aa-drawer__footer'
    );
  });

  it('mounts one prop in both places, so no caller has to mount it twice', () => {
    const html = shell({ items: ITEMS, account: ACCOUNT });

    expect(html).toContain('aa-app-nav__account');
    expect(html).toContain('aa-drawer__footer');
    // Twice, exactly: once in the header and once in the drawer. Three would mean a third mount
    // nobody is standing down, and one would mean a width with no identity anywhere.
    expect(html.split(ACCOUNT)).toHaveLength(3);
  });

  it('leaves exactly one of the two copies live at each width', () => {
    // The header copy stands down below the nav breakpoint...
    expect(winningDeclaration(rules, headerAccount, 'display', 375)?.value).toBe('none');
    expect(winningDeclaration(rules, headerAccount, 'display', 1440)?.value).toBe('flex');

    // ...and the drawer copy cannot be reached above it, because the only thing that opens the
    // drawer is hidden there. This is the half that makes the double mount safe rather than a
    // repeat of the defect it replaces, so it is asserted here and not left to the trigger's own
    // test to imply.
    const trigger: ElementSpec[] = [
      { tag: 'header', classes: ['aa-app-header'] },
      { tag: 'div', classes: ['aa-shell', 'aa-app-nav'] },
      { tag: 'button', classes: ['aa-btn', 'aa-btn--ghost', 'aa-mobile-trigger'] },
    ];
    expect(winningDeclaration(rules, trigger, 'display', 1440)?.value).toBe('none');
    expect(winningDeclaration(rules, trigger, 'display', 375)?.value).toBe('inline-flex');
  });

  it('does not let its content grow the header the whole page measures from', () => {
    // `--height-aa-app-header` feeds `html { scroll-padding-top }`, so every in-page anchor offset
    // in the product is computed from this row being one row tall. An 84-character service-account
    // address wrapped inside the slot and took the header from 64px to 102px — which looks fine on
    // the page and silently mis-aims every anchor jump.
    //
    // Resolved rather than grepped, because the first attempt at this rule LOOKED right and lost:
    // `.aa-button-row { flex-wrap: wrap }` is emitted later at equal specificity, so a bare child
    // selector tied and the later rule won. Only the resolver can tell a correct declaration from
    // one that never applies.
    const buttonRowInSlot: ElementSpec[] = [
      ...headerAccount,
      { tag: 'div', classes: ['aa-button-row'] },
    ];

    expect(
      winningDeclaration(rules, buttonRowInSlot, 'flex-wrap', 1440)?.value,
      'the account row can wrap, so a long identity grows the sticky header'
    ).toBe('nowrap');
    expect(winningDeclaration(rules, headerAccount, 'white-space', 1440)?.value).toBe('nowrap');
  });

  it('keeps children in the drawer footer, where they already were', () => {
    // The slot is additive. A page passing only children must render exactly as it did before.
    const html = shell({ items: ITEMS, children: 'drawer note' });

    expect(html).toContain('drawer note');
    expect(html).not.toContain('aa-app-nav__account');
  });

  it('puts identity above the page’s own footer content, not under it', () => {
    // On a phone this footer is the only place identity appears, so it should not be found
    // beneath whatever else the page decided to put down there.
    const html = shell({ items: ITEMS, account: ACCOUNT, children: 'drawer note' });
    const footer = html.slice(html.indexOf('aa-drawer__footer'));

    expect(footer.indexOf(ACCOUNT)).toBeLessThan(footer.indexOf('drawer note'));
  });

  it('is registered in the design contract with the slot filled', () => {
    // The guide's own header is the live specimen, so the contract cannot document this slot
    // without also exercising it.
    expect(renderToString(StyleGuidePage())).toContain('aa-app-nav__account');
  });
});
