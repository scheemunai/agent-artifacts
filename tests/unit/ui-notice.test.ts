import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { Notice, type NoticeTone } from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
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
const foundationScript = readFileSync('public/assets/ui-foundation-9ff54f825be4.js', 'utf8');

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
});
