import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from '../../src/ui/components/primitives.js';
import { readClientSource } from '../support/client-assets.js';
import { type ElementSpec, parseStylesheet, winningDeclaration } from '../support/css-cascade.js';

/**
 * Two constraints carried over from the lane that specified this component, both about one failure:
 * a control that describes a state instead of an action.
 *
 *  1. The toggle's label says what it WILL DO. "Show password" while masked, "Hide password" while
 *     revealed. The tempting version labels what you are currently looking at, which puts the
 *     control one step out of phase with everyone who takes it at its word.
 *  2. The toggle is a real control, not a glyph on the field — the A-26 touch floor, and the
 *     difference between something that reads as pressable and something that reads as decoration.
 *
 * Both are pinned here because both are the kind of thing a later simplification quietly undoes.
 */
const masked = renderToString(PasswordInput({ id: 'pw', label: 'Password' }));
const revealed = renderToString(PasswordInput({ id: 'pw', label: 'Password', revealed: true }));
const rules = parseStylesheet(readFileSync('src/ui/assets/app.css', 'utf8'));

describe('PasswordInput', () => {
  it('labels the toggle with the action, not the state it is showing', () => {
    expect(masked).toContain('aria-label="Show password"');
    expect(masked, 'a masked field offering to "hide" is backwards').not.toContain(
      'aria-label="Hide password"'
    );
    expect(revealed).toContain('aria-label="Hide password"');
    expect(revealed).not.toContain('aria-label="Show password"');
  });

  it('carries the state in aria-pressed, so the label is free to be an instruction', () => {
    // Without this the visible label would have to do both jobs, and it cannot: an instruction and
    // a status read as opposites to a screen-reader user.
    expect(masked).toContain('aria-pressed="false"');
    expect(revealed).toContain('aria-pressed="true"');
    expect(masked).toContain('type="password"');
    expect(revealed).toContain('type="text"');
  });

  it('makes the toggle a real control at the touch floor', () => {
    // `iconOnly` is what buys the square box; asserted through the class it sets and the rule that
    // sizes it, because "a 44px control" is a composed result of the two and neither half is the
    // guarantee on its own.
    expect(masked, 'the toggle is not an icon button').toContain('aa-btn--icon');
    expect(
      masked,
      'ghost is transparent and borderless — the bare glyph this must not be'
    ).toContain('aa-btn--secondary');

    const toggle: ElementSpec[] = [
      { tag: 'div', classes: ['aa-field'] },
      { tag: 'div', classes: ['aa-password'] },
      {
        tag: 'button',
        classes: ['aa-btn', 'aa-btn--secondary', 'aa-btn--icon', 'aa-password__toggle'],
      },
    ];
    expect(winningDeclaration(rules, toggle, 'width', 1440)?.value).toBe('var(--spacing-aa-touch)');
    expect(winningDeclaration(rules, toggle, 'min-height', 1440)?.value).toBe(
      'var(--spacing-aa-touch)'
    );
  });

  it('always renders the caps hint and always points at it', () => {
    // The CopyBlock rule, for the CopyBlock reason: a hidden target is correctly ignored by
    // assistive tech, and a reference that only sometimes resolves is worse than one that always
    // does. So the element exists from the first paint and `hidden` carries whether it applies.
    expect(masked).toMatch(/<p class="aa-password__caps" id="pw-caps"[^>]*hidden/);
    expect(masked).toContain('aria-describedby="pw-caps"');
    expect(masked).toContain('Caps Lock is on.');
  });

  it('is driven by the shared client contract rather than its own script', () => {
    // Same shape as every other behaviour in the bundle: delegated from the document against data
    // attributes, so a field rendered into a dialog after load needs no re-binding.
    const foundation = readClientSource('ui-foundation.js');

    expect(foundation).toContain('data-aa-password-toggle');
    expect(foundation).toContain('data-aa-password-caps');
    // `getModifierState` is the only reading true on arrival rather than inferred from a keystroke,
    // so a field focused with Caps Lock already down says so immediately.
    expect(foundation).toContain("getModifierState('CapsLock')");
  });
});
