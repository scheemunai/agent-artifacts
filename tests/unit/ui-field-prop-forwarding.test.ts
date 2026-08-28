import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { Input, PasswordInput, Select, Textarea } from '../../src/ui/components/primitives.js';

/**
 * `Textarea`, `Select` and `PasswordInput` derive their props from `InputProps` with an `Omit`,
 * which is the right way to say "the same field, minus these" — and it quietly enrols them in every
 * prop `InputProps` gains afterwards. `autocomplete` was added for `Input` and destructured only
 * there, so both siblings accepted it, type-checked it, and dropped it on the floor.
 *
 * That is a promise the type system makes and the render does not keep, and the compiler actively
 * reassures the caller while it happens.
 *
 * So this WALKS the interface rather than listing the props someone remembered. Every pass-through
 * declared on `InputProps` must reach the element in every component that inherits it, and any prop
 * that is deliberately NOT a plain pass-through has to be named with its reason — the same
 * argued-exception shape the CSS placement guard uses, for the same reason: a list guards what
 * somebody thought of.
 */
const primitivesSource = readFileSync('src/ui/components/primitives.tsx', 'utf8');

/** Props on `InputProps` that are not plain attribute pass-throughs, each with why. */
const NOT_PASS_THROUGH: Record<string, string> = {
  id: 'addresses the label, hint and error; asserted by the FieldShell tests',
  label: 'renders as the <label> element, not an attribute',
  hint: 'renders as a <p> and joins aria-describedby',
  error: 'renders as a <p>, joins aria-describedby, and sets aria-invalid',
  optional: 'renders the Optional tag in the label row',
  state: 'becomes data-aa-state, and disabled/error fold into real attributes',
  type: 'Input only — the siblings Omit it, which is what makes them siblings',
  value: 'an attribute on input/select but element CONTENT on textarea',
  placeholder: 'not valid on select, so it is not a shared pass-through',
  disabled: 'combined with state before it reaches the element',
  name: 'falls back to id when absent, so the rendered value is not the prop',
};

/** Every prop `InputProps` declares, read from the source rather than restated here. */
function declaredInputProps(): string[] {
  const block = /interface InputProps \{([\s\S]*?)\n\}/.exec(primitivesSource)?.[1] ?? '';
  return [...new Set(Array.from(block.matchAll(/^\s{2}(\w+)\??:/gm), (match) => String(match[1])))];
}

/** A sample value per pass-through, and the attribute it must produce. */
const PASS_THROUGH: Record<string, { value: unknown; attr: string }> = {
  autocomplete: { value: 'street-address', attr: 'autocomplete="street-address"' },
  autofocus: { value: true, attr: 'autofocus' },
  spellcheck: { value: false, attr: 'spellcheck="false"' },
  autocapitalize: { value: 'none', attr: 'autocapitalize="none"' },
  autocorrect: { value: 'off', attr: 'autocorrect="off"' },
  // A map rather than a single attribute, but the same promise and the same machinery: spread onto
  // the control, or the client bundle can never bind to the field.
  dataAttrs: { value: { 'data-aa-probe': 'yes' }, attr: 'data-aa-probe="yes"' },
  required: { value: true, attr: 'required' },
};

const FIELDS = [
  { name: 'Input', render: (p: object) => renderToString(Input({ id: 'f', label: 'F', ...p })) },
  {
    name: 'Textarea',
    render: (p: object) => renderToString(Textarea({ id: 'f', label: 'F', ...p })),
  },
  {
    name: 'Select',
    render: (p: object) => renderToString(Select({ id: 'f', label: 'F', options: [], ...p })),
  },
  {
    name: 'PasswordInput',
    render: (p: object) => renderToString(PasswordInput({ id: 'f', label: 'F', ...p })),
  },
] as const;

describe('field primitives forward what their props promise', () => {
  it('accounts for every prop the shared interface declares', () => {
    const declared = declaredInputProps();
    expect(declared.length, 'InputProps not found — check the interface name').toBeGreaterThan(10);

    const unaccounted = declared.filter(
      (prop) => !(prop in PASS_THROUGH) && !(prop in NOT_PASS_THROUGH)
    );
    expect(
      unaccounted,
      `InputProps declares ${unaccounted.join(', ')} and this test does not know what they do. ` +
        'Add them to PASS_THROUGH so every sibling is checked, or to NOT_PASS_THROUGH with the ' +
        'reason they are handled specially. A prop nobody classified is a prop nobody forwarded.'
    ).toEqual([]);
  });

  it('puts every pass-through on the element, in every field that inherits it', () => {
    for (const [prop, { value, attr }] of Object.entries(PASS_THROUGH)) {
      for (const field of FIELDS) {
        expect(
          field.render({ [prop]: value }),
          `${field.name} accepts ${prop} and does not render it — the type says yes and the ` +
            'browser never hears about it'
        ).toContain(attr);
      }
    }
  });

  it('emits nothing when a pass-through was not asked for', () => {
    // Absence has to stay absent: an empty attribute is not the same as no opinion, and a field
    // that always declares something would be guessing on the caller's behalf.
    for (const field of FIELDS) {
      const html = field.render({});
      for (const prop of Object.keys(PASS_THROUGH)) {
        expect(html, `${field.name} invents a ${prop} value`).not.toContain(`${prop}=`);
      }
    }
  });
});
