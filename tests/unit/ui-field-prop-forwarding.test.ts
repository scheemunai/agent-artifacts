import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { Input, Select, Textarea } from '../../src/ui/components/primitives.js';

/**
 * `Textarea` and `Select` derive their props from `InputProps` with an `Omit`, which is the right
 * way to say "the same field, minus these" — and it quietly enrolls them in every prop `Input`
 * gains afterwards. `autocomplete` was added for `Input` in c1fcece and destructured only there, so
 * both of the others accepted it, type-checked it, and dropped it on the floor.
 *
 * That is the same defect class as a specimen painting a state the product cannot produce, pointed
 * at the type system instead of the stylesheet: something the contract promises and the render does
 * not deliver. It is worse here in one way — the compiler actively reassures the caller.
 *
 * So this walks the three field primitives rather than testing the one that was reported. The bug
 * was found on `Textarea` and `Select` had it too; a test written only for the reported instance
 * would have shipped the second one.
 */
const FIELDS = [
  {
    name: 'Input',
    render: (autocomplete: string) =>
      renderToString(Input({ id: 'f', label: 'Field', autocomplete })),
  },
  {
    name: 'Textarea',
    render: (autocomplete: string) =>
      renderToString(Textarea({ id: 'f', label: 'Field', autocomplete })),
  },
  {
    name: 'Select',
    render: (autocomplete: string) =>
      renderToString(Select({ id: 'f', label: 'Field', options: [], autocomplete })),
  },
] as const;

describe('field primitives forward what their props promise', () => {
  it('puts autocomplete on the element, in every field that accepts it', () => {
    for (const field of FIELDS) {
      expect(
        field.render('street-address'),
        `${field.name} accepts autocomplete and does not render it — the type says yes and the ` +
          'browser never hears about it'
      ).toContain('autocomplete="street-address"');
    }
  });

  it('emits no autocomplete attribute when none was asked for', () => {
    // The absence has to stay absent: an empty attribute is not the same as no opinion, and a
    // field that always declares something would be guessing on the caller's behalf.
    for (const field of FIELDS) {
      const html = renderToString(
        field.name === 'Select'
          ? Select({ id: 'f', label: 'Field', options: [] })
          : field.name === 'Textarea'
            ? Textarea({ id: 'f', label: 'Field' })
            : Input({ id: 'f', label: 'Field' })
      );

      expect(html, `${field.name} invents an autocomplete value`).not.toContain('autocomplete=');
    }
  });
});
