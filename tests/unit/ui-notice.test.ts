import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import {
  Card,
  Notice,
  type NoticeTone,
  StatusHeading,
} from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import { readClientSource } from '../support/client-assets.js';
import { declarationValue, parseStylesheet } from '../support/css-cascade.js';

/**
 * The product had no alert primitive at all. Page-level feedback — "Artifact deleted.", "Typed
 * confirmation did not match.", "Key regenerated. Old key is invalid now." — shipped as a 12px
 * `Badge`: a bare `<span>` with no icon, no dismissal and no live region, sitting directly above
 * identity pills of the identical shape, so chrome and feedback were the same object on screen.
 *
 * The in-repo references this component is built from are the two feedback surfaces the audit
 * confirmed correct: the viewer's "Updated ✓" pill (an inline status attached to the object whose
 * state changed) and the inline terminal's EmptyState (mark + title + action).
 */
const appCssSource = readFileSync('src/ui/assets/app.css', 'utf8');
const appRules = parseStylesheet(appCssSource);
const foundationScript = readClientSource('ui-foundation.js');

const TONES: NoticeTone[] = ['info', 'success', 'warn', 'danger'];

function noticeRule(selector: string) {
  const rule = appRules.find((candidate) => candidate.selector === selector);
  if (!rule) {
    throw new Error(`no rule for ${selector}`);
  }
  return rule.block;
}

describe('Notice', () => {
  it('renders all four tones with a tone-appropriate live region', () => {
    for (const tone of TONES) {
      const html = renderToString(Notice({ tone, title: 'Artifact deleted.', children: 'Done.' }));

      expect(html, tone).toContain(`aa-notice--${tone}`);
      // Recoverable caution and blocking failure interrupt; confirmations do not.
      expect(html, tone).toContain(
        tone === 'warn' || tone === 'danger' ? 'role="alert"' : 'role="status"'
      );
    }
  });

  it('ships a real icon per tone rather than a Unicode stand-in', () => {
    for (const tone of TONES) {
      const html = renderToString(Notice({ tone, children: 'Message.' }));

      expect(html, tone).toContain('aa-notice__icon');
      expect(html, tone).toContain('<svg');
      expect(html, tone).not.toMatch(/[◆↕⭳↻]/);
    }

    const icons = new Set(
      TONES.map((tone) => {
        const html = renderToString(Notice({ tone, children: 'Message.' }));
        return /<svg[\s\S]*?<\/svg>/.exec(html)?.[0] ?? tone;
      })
    );
    expect(icons.size, 'each tone needs its own mark, not one shared glyph').toBe(TONES.length);
  });

  it('offers dismissal at the 44px touch floor and hydrates without inline handlers', () => {
    const dismissible = renderToString(
      Notice({ tone: 'success', children: 'Artifact deleted.', dismissible: true })
    );

    expect(dismissible).toContain('data-aa-notice-dismiss="true"');
    expect(dismissible).toContain('aria-label="Dismiss notice"');
    expect(dismissible).not.toMatch(/on(click|submit|keydown)=/i);
    expect(foundationScript).toContain('data-aa-notice-dismiss');

    const dismiss = noticeRule('.aa-notice__dismiss');
    expect(declarationValue(dismiss, 'width')).toBe('var(--spacing-aa-touch)');
    expect(declarationValue(dismiss, 'height')).toBe('var(--spacing-aa-touch)');
  });

  it('never animates a property that would move the page', () => {
    // A notice is in normal flow and honest about the space it takes. It must not be positioned
    // out of flow, and it must not transition anything that reflows its neighbours.
    const notice = noticeRule('.aa-notice');

    expect(declarationValue(notice, 'position')).toBeUndefined();
    const transition = declarationValue(notice, 'transition') ?? '';
    expect(transition).not.toMatch(/height|width|margin|padding|top|bottom|left|right|inset/);
  });

  it('keeps the message column collapsible so long copy cannot widen a phone', () => {
    expect(declarationValue(noticeRule('.aa-notice'), 'grid-template-columns')).toContain(
      'minmax(0, 1fr)'
    );
    expect(declarationValue(noticeRule('.aa-notice__body'), 'min-width')).toBe('0');
  });

  it('is registered in the style guide with every tone, including warn', () => {
    const html = renderToString(StyleGuidePage());

    expect(html).toContain('Notice');
    for (const tone of TONES) {
      expect(html, tone).toContain(`aa-notice--${tone}`);
    }
    // The regenerate-key outcome is the canonical warn case: a breaking, security-relevant change
    // that shipped in success green.
    expect(html).toContain('Old key is invalid now');
  });

  it('is attached by default, and detaching it is an explicit choice with a cost', () => {
    // Measured across the product: every status except the viewer's Updated pill is detached from
    // its subject — "Link sent" floats 32px above its own heading, the setup validation error
    // ~300px above the field it names. A prettier component placed the same way is the same defect,
    // so the default posture is attached, and the page-level posture has to be asked for.
    const attached = renderToString(Notice({ tone: 'danger', children: 'Nothing was deleted.' }));
    const page = renderToString(
      Notice({ tone: 'danger', children: 'Nothing was deleted.', placement: 'page' })
    );

    expect(attached).not.toContain('tabindex');
    expect(attached).not.toContain('data-aa-notice-page');

    // If a notice must sit away from what it describes, it has to be reachable: focusable, and
    // taken to on load, so it is announced instead of scrolled past.
    expect(page).toContain('tabindex="-1"');
    expect(page).toContain('data-aa-notice-page="true"');
    expect(foundationScript).toContain('data-aa-notice-page');
    expect(foundationScript).toContain('focus');
  });

  it('has a slot inside the card whose outcome it reports', () => {
    const html = renderToString(
      Card({
        title: 'Password',
        notice: Notice({ tone: 'success', children: 'Password updated.' }),
        children: 'body',
      })
    );

    const header = html.indexOf('aa-card__header');
    const notice = html.indexOf('aa-notice');
    const body = html.indexOf('aa-card__body');

    expect(notice).toBeGreaterThan(header);
    expect(notice).toBeLessThan(body);
    expect(html).toContain('aa-card__notice');
  });
});

describe('StatusHeading', () => {
  it('binds a status into the heading row it describes', () => {
    // The generalisation of the viewer's Updated pill: the status lives inside the heading row,
    // not 32px above it in a stack gap.
    const html = renderToString(
      StatusHeading({
        level: 2,
        children: 'Check your email',
        status: 'Link sent',
        tone: 'success',
      })
    );

    const heading = /<h2[\s\S]*?<\/h2>/.exec(html);
    expect(heading).not.toBeNull();

    const badge = html.indexOf('aa-badge');
    const rowEnd = html.lastIndexOf('</div>');
    expect(badge).toBeGreaterThan(html.indexOf('aa-status-heading'));
    expect(badge).toBeLessThan(rowEnd);
    expect(html).toContain('Link sent');
  });

  it('renders the heading alone when there is no status to attach', () => {
    const html = renderToString(StatusHeading({ level: 3, children: 'Your templates' }));

    expect(html).toContain('<h3');
    expect(html).not.toContain('aa-badge');
  });

  it('is registered in the style guide beside the attachment rule', () => {
    const guide = renderToString(StyleGuidePage());

    expect(guide).toContain('aa-status-heading');
    expect(guide).toContain('Where a status goes');
  });
});
