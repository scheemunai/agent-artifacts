import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { CopyBlock } from '../../src/ui/components/primitives.js';
import { HomePage } from '../../src/ui/pages/home.js';
import { LoginPage } from '../../src/ui/pages/login.js';
import { LoginPlaceholderPage, SetupPlaceholderPage } from '../../src/ui/pages/placeholder.js';
import { SetupKeyPage, SetupPage } from '../../src/ui/pages/setup.js';

const BASE = 'https://example.test';

/**
 * A-47 (P1). The setup token is a one-time value the operator reads out of the server boot log.
 * Losing it on a validation slip sends them back to the terminal.
 */
describe('A-47 · the setup token survives a validation error', () => {
  it('renders the submitted token back into the field', () => {
    const html = renderToString(
      SetupPage({ baseUrl: BASE, setupToken: 'tok_abc123', error: 'Password must be longer' })
    );

    expect(html).toMatch(/id="setup_token"[^>]*value="tok_abc123"/);
  });

  it('keeps every other field round-tripped alongside it', () => {
    const html = renderToString(
      SetupPage({
        baseUrl: BASE,
        setupToken: 'tok_abc123',
        email: 'ops@example.test',
        botName: 'R2',
        botByline: 'Chief of staff',
        error: 'Password must be longer',
      })
    );

    for (const value of ['tok_abc123', 'ops@example.test', 'R2', 'Chief of staff']) {
      expect(html).toContain(`value="${value}"`);
    }
  });

  it('attaches a field-level error to the field that caused it, not to the top of the form', () => {
    const html = renderToString(
      SetupPage({
        baseUrl: BASE,
        error: 'Password must be at least 8 characters',
        errorField: 'password',
      })
    );

    // Rung 2 of the attachment ladder: the message rides the field.
    expect(html).toMatch(/id="password-error"/);
    expect(html).toMatch(/id="password"[^>]*aria-invalid="true"/);
    // Amended, not weakened. The invariant is that the error is ANNOUNCED WITH the field, and that
    // is still asserted. What changed is that the field now also owns a caps-lock hint, so
    // aria-describedby legitimately carries two ids; pinning the attribute to one exact value would
    // have made a correct a11y addition look like a regression. Substring, not equality.
    expect(html).toMatch(/id="password"[^>]*aria-describedby="[^"]*password-error/);

    // The defect was a *detached* error: a bare `aa-error` paragraph parked above the form with no
    // field of its own. FieldShell's own error paragraph carries an id, so the invariant is that
    // every aa-error paragraph is field-scoped, not that the class is unused.
    const detached = [...html.matchAll(/<p class="aa-error"(?! id=)/g)];
    expect(detached).toHaveLength(0);
  });

  it('still reports a form-level error when no field owns it', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE, error: 'Setup token is invalid' }));

    expect(html).toContain('Setup token is invalid');
  });
});

/** A-48 (P1). A stepper that promises navigable progress it does not provide is dead UI. */
describe('A-48 · the setup form does not assert steps that do not exist', () => {
  it('does not render a four-step progress claim over a single card', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));

    expect(html).not.toContain('1 Token');
    expect(html).not.toContain('2 Admin');
    expect(html).not.toContain('3 Bot');
    expect(html).not.toContain('4 Key');
  });

  it('says what is actually true about the form', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));

    expect(html).toMatch(/one form|single form|all at once|one step/i);
  });
});

/**
 * A-49 (P1). A screen's header is part of its state. The magic-link-sent screen must not keep
 * instructing the action it is simultaneously confirming.
 */
describe('A-49 · state transitions take the header with them', () => {
  it('drops the prior-state instruction once the link is sent', () => {
    const html = renderToString(
      LoginPage({ mode: 'magic', email: 'ops@example.test', sent: true, mailAvailable: true })
    );

    expect(html).not.toContain('Enter your email and we will send a 15-minute sign-in link.');
    expect(html).toContain('Check your email');
  });

  it('still instructs before the link is sent', () => {
    const html = renderToString(LoginPage({ mode: 'magic', mailAvailable: true }));

    expect(html).toContain('Enter your email and we will send a 15-minute sign-in link.');
    expect(html).not.toContain('Check your email');
  });

  it('leaves exactly one h1 on the sent screen', () => {
    const html = renderToString(
      LoginPage({ mode: 'magic', email: 'ops@example.test', sent: true, mailAvailable: true })
    );

    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
  });
});

/** A-51 (P2). A badge in a stack gap is a chip with no owner; a badge in a heading row is status. */
describe('A-51 · the sent status is attached to the heading it describes', () => {
  it('binds "Link sent" into the heading row rather than floating above it', () => {
    const html = renderToString(
      LoginPage({ mode: 'magic', email: 'ops@example.test', sent: true, mailAvailable: true })
    );

    expect(html).toContain('aa-status-heading');
    const headingBlock = html.slice(
      html.indexOf('aa-status-heading'),
      html.indexOf('aa-status-heading') + 400
    );
    expect(headingBlock).toContain('Link sent');
    expect(headingBlock).toContain('Check your email');
  });
});

/**
 * A-13 (P2). The anonymous marketing header carries one action too many for 375. The authenticated
 * state renders cleanly on one row; the anonymous one must too.
 */
describe('A-13 · the anonymous marketing header fits 375', () => {
  it('carries no more header actions when anonymous than when authenticated', () => {
    const anonymous = renderToString(HomePage({ baseUrl: BASE }));
    const authenticated = renderToString(HomePage({ baseUrl: BASE, authenticated: true }));

    const countCompact = (html: string) =>
      (html.slice(0, html.indexOf('</header>')).match(/aa-btn--compact-hide/g) ?? []).length;

    // The secondary action is the one that overflows; it must be the one that stands down.
    expect(countCompact(anonymous)).toBeGreaterThan(0);
    expect(countCompact(authenticated)).toBe(0);
  });

  it('keeps the log-in affordance reachable when the header sheds it', () => {
    const html = renderToString(HomePage({ baseUrl: BASE }));
    const footer = html.slice(html.indexOf('aa-marketing-footer'));

    expect(footer).toContain('/login?mode=magic');
  });

  it('does not offer a log-in affordance to a signed-in visitor', () => {
    const html = renderToString(HomePage({ baseUrl: BASE, authenticated: true }));
    const footer = html.slice(html.indexOf('aa-marketing-footer'));

    expect(footer).not.toContain('Log in');
  });
});

/**
 * A-52 (P2). A copy-once credential a human may transcribe must never be broken mid-token, and a
 * scroll hint on a block that cannot scroll is a false statement.
 */
describe('A-52 · credential blocks do not break tokens or lie about scrolling', () => {
  it('marks a credential block so it never wraps mid-token', () => {
    const html = renderToString(
      CopyBlock({
        id: 'k',
        label: 'API key',
        value: 'aa_bot_0123456789abcdef',
        variant: 'credential',
      })
    );

    expect(html).toContain('aa-copy--credential');
  });

  it('shows no scroll hint on a single-line block until something proves it scrolls', () => {
    // Amended, not weakened — the intent (nothing may claim a block scrolls when it does not) is
    // unchanged and still asserted. What changed is *when* the claim is settled: a `credential`
    // block does not wrap, so a long key overflows horizontally, which the value cannot reveal and
    // only a measurement can. The hint is therefore rendered `hidden` rather than omitted, so the
    // shared `data-aa-scroll-region` mechanism has something to unhide, and so `aria-describedby`
    // points at a real element instead of dangling. Nothing is visible until it is true.
    const html = renderToString(
      CopyBlock({
        id: 'k',
        label: 'API key',
        value: 'aa_bot_0123456789abcdef',
        variant: 'credential',
      })
    );

    expect(html).toMatch(/<p class="aa-copy__hint" id="k-hint"[^>]*hidden/);
    expect(html).toContain('data-aa-scroll-hint-for="k-hint"');
  });

  it('keeps the hint on a genuinely multi-line block', () => {
    const html = renderToString(
      CopyBlock({ id: 'p', label: 'Install prompt', value: 'line one\nline two\nline three' })
    );

    expect(html).toContain('Scroll inside the block');
    expect(html).toContain('aria-describedby="p-hint"');
  });

  it('renders the shown-once key through the credential variant', () => {
    const html = renderToString(
      SetupKeyPage({
        baseUrl: BASE,
        email: 'a@b.test',
        botName: 'R2',
        apiKey: 'aa_bot_abcdef123456',
      })
    );

    // The credential class sits on the <section>, which opens before its aria-labelledby id, so
    // slice from the section that owns setup-key rather than from the first id occurrence.
    const keyBlock = html.slice(
      html.lastIndexOf('<section', html.indexOf('setup-key-label')),
      html.indexOf('setup-install-prompt')
    );
    expect(keyBlock).toContain('aa-copy--credential');

    // and the multi-line prompt beside it is deliberately NOT a credential block
    const promptBlock = html.slice(
      html.indexOf('setup-install-prompt'),
      html.indexOf('setup-curl')
    );
    expect(promptBlock).not.toContain('aa-copy--credential');
  });
});

/**
 * A-31 (P2). Six marketing sections ran on four different measures, so nothing shared a left edge
 * and the eye tracked a staircase down the page. Three measures, each with a stated job.
 */
describe('A-31 · the marketing page runs on three measures, not four', () => {
  const css = readFileSync(new URL('../../src/ui/assets/app.css', import.meta.url), 'utf8');

  const marketingBlock = (selector: string) => {
    const start = css.indexOf(`  .${selector} {`);
    expect(start, `${selector} rule not found`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  /**
   * The token a section sizes ITSELF with.
   *
   * Read from the `width` declaration rather than "the first width token anywhere in the block",
   * which is what this was and which stopped being true the moment a section used two: the terms
   * card is a panel that lays a reading column inside itself, so the block legitimately names both.
   * The old proxy reported the column's token as the card's own and called a correct composition a
   * violation. Same shape as the rest of this round — the assertion was right while the data was
   * simple, and read the wrong thing the moment it was not.
   */
  const marketingRule = (selector: string) =>
    /(?:^|\s)width:[^;]*var\((--width-aa-[a-z-]+)\)/.exec(marketingBlock(selector))?.[1];

  it('maps every marketing section to one of exactly three width tokens', () => {
    const measures = new Set(
      [
        'aa-marketing-shell',
        'aa-marketing-artifact',
        'aa-marketing-api-wrap',
        'aa-marketing-features',
        'aa-marketing-origin',
        'aa-marketing-terms',
      ].map(marketingRule)
    );

    expect(measures).toEqual(
      new Set(['--width-aa-shell-marketing', '--width-aa-panel', '--width-aa-measure'])
    );
  });

  it('puts the raised cards on the panel measure and the reading column on the text measure', () => {
    expect(marketingRule('aa-marketing-artifact')).toBe('--width-aa-panel');
    expect(marketingRule('aa-marketing-terms')).toBe('--width-aa-panel');

    for (const reading of [
      'aa-marketing-api-wrap',
      'aa-marketing-features',
      'aa-marketing-origin',
    ]) {
      expect(marketingRule(reading)).toBe('--width-aa-measure');
    }
  });

  it('lays the terms card’s prose on the same reading column as the rest of the page', () => {
    // A-36's second half. The card is a panel — asserted above — and the text inside it is not: it
    // sits on `--width-aa-measure`, the column `.aa-marketing-origin`, `.aa-marketing-features` and
    // `.aa-marketing-api-wrap` already use. That is what puts the origin quote, the API block, the
    // price and the MIT line on one left edge from 1024 up, instead of the card inventing its own
    // width and landing 38px off its neighbours.
    //
    // Composition, not a fourth measure: the section names two of the three tokens, one for the
    // card and one for the column inside it, which is why the helper above reads `width` rather
    // than the first token it finds.
    expect(marketingBlock('aa-marketing-terms')).toMatch(
      /grid-template-columns:\s*min\(100%,\s*var\(--width-aa-measure\)\)/
    );
  });

  it('defines no width token the product does not use', () => {
    const defined = [...css.matchAll(/^\s{2}(--width-aa-[a-z-]+):/gm)].map((m) => m[1]);
    const unused = defined.filter(
      (token) => (css.match(new RegExp(`var\\(${token}\\)`, 'g')) ?? []).length === 0
    );

    expect(unused).toEqual([]);
  });
});

/** I-12 / A-19. `aa-specimen-row` is style-guide scaffolding; production uses ButtonRow. */
describe('ButtonRow adoption · no page in this batch ships aa-specimen-row', () => {
  const pages: Array<[string, string]> = [
    ['SetupPage', renderToString(SetupPage({ baseUrl: BASE }))],
    [
      'SetupKeyPage',
      renderToString(
        SetupKeyPage({ baseUrl: BASE, email: 'a@b.test', botName: 'R2', apiKey: 'aa_bot_x' })
      ),
    ],
    ['LoginPage', renderToString(LoginPage({ mode: 'magic', mailAvailable: true }))],
    ['LoginPage password', renderToString(LoginPage({ mode: 'password', mailAvailable: true }))],
    ['HomePage', renderToString(HomePage({ baseUrl: BASE }))],
    ['SetupPlaceholderPage', renderToString(SetupPlaceholderPage())],
    ['LoginPlaceholderPage', renderToString(LoginPlaceholderPage())],
  ];

  for (const [name, html] of pages) {
    it(`${name} uses aa-button-row`, () => {
      expect(html).not.toContain('aa-specimen-row');
    });
  }
});

/**
 * The style guide documents `autocomplete` as the browser's own vocabulary, required on every
 * password field the product ships. Three of these boxes are passwords. The fourth only looks like
 * one.
 */
describe('password fields declare what they hold', () => {
  const attr = (html: string, id: string) => {
    const tag = new RegExp(`<input[^>]*id="${id}"[^>]*>`).exec(html)?.[0] ?? '';
    return /autocomplete="([^"]*)"/.exec(tag)?.[1];
  };

  it('tells a manager which password is the current one on the log-in form', () => {
    const html = renderToString(LoginPage({ mode: 'password', mailAvailable: true }));

    expect(attr(html, 'password')).toBe('current-password');
  });

  it('marks both setup password boxes as new, so neither is filled with an existing one', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));

    expect(attr(html, 'password')).toBe('new-password');
    expect(attr(html, 'password_confirm')).toBe('new-password');
  });

  it('does not let the one-time setup token be saved as the site password', () => {
    const html = renderToString(SetupPage({ baseUrl: BASE }));

    // It is masked because it is a secret, not because it is a password. It is a code the operator
    // reads out of the boot log once and never again, so it gets the vocabulary for that.
    expect(attr(html, 'setup_token')).toBe('one-time-code');
    expect(attr(html, 'setup_token')).not.toBe('current-password');
    expect(attr(html, 'setup_token')).not.toBe('new-password');
  });

  it('leaves no password box in this batch without a declared purpose', () => {
    const pages = [
      renderToString(LoginPage({ mode: 'password', mailAvailable: true })),
      renderToString(SetupPage({ baseUrl: BASE })),
    ];

    for (const html of pages) {
      for (const tag of html.match(/<input[^>]*type="password"[^>]*>/g) ?? []) {
        expect(tag).toMatch(/autocomplete="/);
      }
    }
  });
});
