import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { PasswordGate } from '../../src/ui/pages/viewer.js';
import { readClientSource } from '../support/client-assets.js';

/**
 * A-39, viewer half: the password gate adopts the registered primitives.
 *
 * The gate scored a 6 for two absences — no autofocus and no reveal — and both were deliberately
 * left until the mechanism existed. Building a gate-local reveal would have been the third or
 * fourth instance of this project's most expensive habit: two mechanisms for one job, discovered a
 * round later when they disagree. So this waited for `PasswordInput`, and adopts it rather than
 * reimplementing it.
 *
 * Autofocus is conditional on the gate being *visible*, which is the whole of the primitive's
 * documented rule: the first actionable field of a page whose only job is that form. The gate
 * element renders on every viewer page — hidden when the artifact needs no password — so an
 * unconditional autofocus would steal the caret on pages that exist to be read.
 */

const gateHtml = (visible: boolean) => renderToString(PasswordGate({ visible }));

describe('the viewer password gate', () => {
  it('is built from the registered password field, not a hand-rolled one', () => {
    const html = gateHtml(true);

    // The primitive's own markers: the wrapper, the field, and the toggle that made this wait.
    expect(html).toContain('data-aa-password="true"');
    expect(html).toContain('data-aa-password-input="true"');
    expect(html).toContain('data-aa-password-toggle="aa-share-password"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Show password');

    // Caps Lock on arrival — the state a password field silently fails at.
    expect(html).toContain('data-aa-password-caps="true"');
  });

  it('focuses the field when the gate is the page, and not when it is hidden', () => {
    expect(gateHtml(true)).toContain('autofocus');

    // The gate is rendered on every viewer page. Autofocusing a hidden field would move the caret
    // on a page whose job is to be read.
    expect(gateHtml(false)).not.toContain('autofocus');
  });

  it('keeps the identifiers the client script binds to', () => {
    const html = gateHtml(true);
    const client = readClientSource('viewer.js');

    // Adoption must not rename the seams: the script finds the field by id and the error by data
    // attribute, and a swap that broke either would disable the gate silently.
    expect(html).toContain('id="aa-share-password"');
    expect(html).toContain('data-aa-password-error="true"');
    expect(client).toContain("getElementById('aa-share-password')");
    expect(client).toContain('[data-aa-password-error]');
  });

  it('still refuses to submit an empty password', () => {
    const client = readClientSource('viewer.js');

    // The hand-rolled field carried `required`, and the browser's constraint validation is what
    // stopped an empty submit before the handler ran. Adopting the primitive dropped that guard
    // for one round — the client would have POSTed an empty string, spent a rate-limit attempt,
    // and answered "Incorrect password." to someone who typed nothing — so the guard moved into
    // the script that actually does the submitting, and stays there. See below for why it stays
    // even now that the declarative half is back.
    expect(client).toMatch(/if\s*\(!passwordInput\.value/);
  });

  /**
   * Both layers, asserted together, because either one alone is a different and weaker claim.
   *
   * `required` is the first line: it is the browser's own stop, it arrives before any script runs,
   * it survives a script that fails to load, and it is what makes the field announce itself as
   * required to assistive technology rather than merely behaving that way. That is why it is worth
   * declaring the moment the primitive can carry it.
   *
   * It is not the last line. Constraint validation is trivially bypassable — a submit fired from
   * script, an autofilled-then-cleared field, `noValidate` on the form — and the request that
   * results costs a real attempt against the rate limiter. So the script guard is not redundant
   * with it; it is the half that still answers when the first half is skipped.
   *
   * Asserting only the attribute would let the script guard be deleted silently, and asserting only
   * the script would let the attribute be dropped again. The defect this round exists to close was
   * created by exactly that kind of one-sided assertion.
   */
  it('states the requirement declaratively and still guards it in script', () => {
    const html = gateHtml(true);
    const client = readClientSource('viewer.js');

    const passwordInputTag = html.match(/<input[^>]*data-aa-password-input="true"[^>]*>/)?.[0];
    expect(
      passwordInputTag,
      'the gate no longer renders the registered password input'
    ).toBeDefined();
    expect(
      passwordInputTag,
      'the browser-side stop is missing — the field is not declared required'
    ).toContain('required');

    expect(
      client,
      'the script guard was removed — an empty submit now reaches the server whenever validation is bypassed'
    ).toMatch(/if\s*\(!passwordInput\.value/);
  });
});
