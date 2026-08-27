import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmDestructive } from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import { readClientSource } from '../support/client-assets.js';
import { type ElementSpec, parseStylesheet, winningDeclaration } from '../support/css-cascade.js';

/**
 * Every destructive action in the product is an always-open, permanently expanded type-to-confirm
 * form. The bots page carries eight live destructive inputs at rest. There is no deliberate second
 * step and no "this cannot be undone" moment anywhere — while the style guide defines, documents
 * and demonstrates a `ConfirmationDialog` that no screen uses.
 *
 * This is the canonical shape those screens adopt: trigger → dialog → typed confirmation inside
 * the dialog. Nothing here is wired into a page yet; the point is that the adoption is mechanical.
 */
const appCssSource = readFileSync('src/ui/assets/app.css', 'utf8');
const appRules = parseStylesheet(appCssSource);
const foundationScript = readClientSource('ui-foundation.js');

const render = () =>
  renderToString(
    ConfirmDestructive({
      id: 'revoke-share',
      triggerLabel: 'Revoke link',
      title: 'Revoke this share link?',
      description: 'The current URL stops working immediately. Re-sharing creates a new URL.',
      consequence: 'This cannot be undone.',
      confirmValue: 'weekly-ops',
      confirmLabel: 'Revoke link',
      action: '/dashboard/api/shares/revoke',
      fields: { artifact_id: 'art_123' },
    })
  );

describe('ConfirmDestructive', () => {
  it('is a trigger at rest, with the typed confirmation behind it', () => {
    const html = render();

    // The dialog element carries no `open`, so nothing is expanded until asked for.
    expect(html).toContain('data-aa-open-dialog="revoke-share-dialog"');
    expect(html).toMatch(/<dialog[^>]*id="revoke-share-dialog"/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);

    // And the input lives inside that dialog, not on the page.
    const dialogStart = html.indexOf('<dialog');
    const inputIndex = html.indexOf('data-aa-confirm-match');
    expect(dialogStart).toBeGreaterThanOrEqual(0);
    expect(inputIndex).toBeGreaterThan(dialogStart);
  });

  it('names the exact words that must be typed, and says what cannot be undone', () => {
    const html = render();

    expect(html).toContain('data-aa-confirm-match="weekly-ops"');
    expect(html).toContain('This cannot be undone.');
    expect(html).toContain('weekly-ops');
  });

  it('keeps the destructive action inert until the confirmation matches', () => {
    const html = render();

    const confirmButton = /<button[^>]*data-aa-confirm-submit="revoke-share"[^>]*>/.exec(html)?.[0];
    expect(confirmButton, 'no confirming button').toBeDefined();
    expect(confirmButton).toContain('disabled');
    expect(confirmButton).toContain('type="submit"');
    expect(foundationScript).toContain('data-aa-confirm-match');
    expect(foundationScript).toContain('data-aa-confirm-submit');
  });

  it('gives Cancel the initial focus, as the safe default', () => {
    const html = render();

    expect(html).toContain('data-aa-cancel="true"');
    expect(foundationScript).toContain('[data-aa-cancel]');
  });

  it('submits a real form with the fields the action needs', () => {
    const html = render();

    expect(html).toContain('action="/dashboard/api/shares/revoke"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="artifact_id"');
    expect(html).toContain('value="art_123"');
    // The confirming button lives in the dialog footer, so it targets the form by id.
    expect(html).toContain('form="revoke-share-form"');
  });

  it('inverts the danger hierarchy back: soft trigger, solid confirmation', () => {
    // `.aa-btn--danger` is a pale-pink fill with red text — right for a trigger, wrong for the
    // action that actually destroys something, which was rendering as the quietest control on the
    // page while the safe primary sat next to it as a saturated block.
    const trigger: ElementSpec[] = [{ tag: 'button', classes: ['aa-btn', 'aa-btn--danger'] }];
    const confirm: ElementSpec[] = [
      { tag: 'dialog', classes: ['aa-dialog', 'aa-dialog--destructive'] },
      { tag: 'div', classes: ['aa-dialog__panel'] },
      { tag: 'footer', classes: ['aa-dialog__actions'] },
      { tag: 'button', classes: ['aa-btn', 'aa-btn--danger'] },
    ];

    expect(winningDeclaration(appRules, trigger, 'background', 1440)?.value).toBe(
      'var(--color-aa-danger-soft)'
    );
    expect(winningDeclaration(appRules, confirm, 'background', 1440)?.value).toBe(
      'var(--color-aa-danger)'
    );
    expect(winningDeclaration(appRules, confirm, 'color', 1440)?.value).toBe(
      'var(--color-aa-accent-ink)'
    );
  });

  it('is registered in the style guide as the canonical destructive pattern', () => {
    const html = renderToString(StyleGuidePage());

    expect(html).toContain('Destructive confirmation');
    expect(html).toContain('data-aa-confirm-match');
    expect(html).toContain('cannot be undone');
  });
});
