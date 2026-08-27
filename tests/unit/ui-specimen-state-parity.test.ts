import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStylesheet, type StyleRule } from '../support/css-cascade.js';

/**
 * The style guide paints its states with `data-aa-state`, because a printed specimen cannot hover
 * or take focus. That makes every specimen a *claim* about what the product does, and the claim is
 * only as good as the pairing between the attribute rule and the real one.
 *
 * It has already failed once. `[data-aa-state="focus"]` is declared unqualified in the base layer —
 * it is the specimen twin of the global `:focus-visible` rule — so it matches ANY element the guide
 * marks as focused, including components whose real focus treatment differs. The list row draws an
 * inset ring with no halo, and the specimen drew the base halo on top: a guide showing a state the
 * product cannot produce, which is worse than showing nothing, because it is the version people
 * copy.
 *
 * Two invariants hold the class shut, rather than the one instance:
 *
 *  1. Where a component styles a real state and its specimen, the two declare the same thing.
 *  2. No NEW unqualified `[data-aa-state=…]` rule appears. That shape is the trap: it reaches
 *     specimens it has never heard of. The base focus rule is the one grandfathered case, and it
 *     is why invariant 1 matters — anything overriding it must do so on purpose.
 */
const css = readFileSync('src/ui/assets/app.css', 'utf8');
const rules = parseStylesheet(css);

/** The real-state pseudo-class each `data-aa-state` value is a stand-in for. */
const STATE_PSEUDOS: Record<string, string> = {
  hover: ':hover',
  active: ':active',
  disabled: ':disabled',
};

function declarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of block.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]+)/gm)) {
    out.set(String(match[1]).trim(), String(match[2]).trim());
  }
  return out;
}

function fingerprint(block: string): string {
  return [...declarations(block)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([property, value]) => `${property}: ${value}`)
    .join('; ');
}

/** Rules keyed by the selector with the state part replaced by a placeholder. */
function pairsFor(
  state: string,
  pseudo: string
): Map<string, { real?: StyleRule; spec?: StyleRule }> {
  const paired = new Map<string, { real?: StyleRule; spec?: StyleRule }>();
  for (const rule of rules) {
    const attribute = `[data-aa-state="${state}"]`;
    if (rule.selector.includes(attribute)) {
      const key = rule.selector.replaceAll(attribute, '§');
      paired.set(key, { ...paired.get(key), spec: rule });
      continue;
    }
    // `:focus-within` and friends are not stand-ins for anything the guide can mark, so only the
    // exact pseudo this state stands for counts.
    if (rule.selector.includes(pseudo)) {
      const key = rule.selector.replaceAll(pseudo, '§');
      paired.set(key, { ...paired.get(key), real: rule });
    }
  }
  return paired;
}

describe('specimen states match the states they stand for', () => {
  it('finds the specimen rules it is meant to police', () => {
    const specimens = rules.filter((rule) => rule.selector.includes('data-aa-state'));
    expect(specimens.length, 'no data-aa-state rules found — check the parser').toBeGreaterThan(10);
  });

  it('declares the same thing for a specimen state as for the real one', () => {
    for (const [state, pseudo] of Object.entries(STATE_PSEUDOS)) {
      for (const [selector, pair] of pairsFor(state, pseudo)) {
        if (!pair.real || !pair.spec) {
          // One-sided is a different question — a real state with no specimen understates the
          // guide, and a specimen with no real rule is caught by the grandfather check below.
          continue;
        }
        expect(
          fingerprint(pair.spec.block),
          `${selector.replace('§', `[data-aa-state="${state}"]`)} paints something ` +
            `${selector.replace('§', pseudo)} does not — the guide would be showing a state the ` +
            'product cannot produce'
        ).toBe(fingerprint(pair.real.block));
      }
    }
  });

  it('adds no unqualified state rule beyond the base focus ring', () => {
    // An unqualified `[data-aa-state=…]` rule matches every specimen in the document, including
    // ones written later by someone who has never read it. That is exactly how the list row's
    // phantom halo happened, so the shape is capped at the single case that earns it.
    const unqualified = rules
      .filter((rule) => /^\[data-aa-state/.test(rule.selector.trim()))
      .map((rule) => rule.selector.trim());

    expect(
      unqualified,
      'a new unqualified data-aa-state rule will reach specimens it has never heard of; ' +
        'qualify it with the component that owns the state'
    ).toEqual(['[data-aa-state="focus"]']);
  });

  it('lets a component that overrides the base focus ring do it for both paths at once', () => {
    // The grandfathered rule is only safe while components that differ from it say so for the real
    // path AND the specimen path in the same breath. The list row is the case that proves it: one
    // rule, two selectors, so the specimen cannot drift from the behaviour again.
    const overrides = rules.filter(
      (rule) =>
        rule.selector.includes('[data-aa-state="focus"]') &&
        rule.selector.trim() !== '[data-aa-state="focus"]'
    );
    expect(overrides.length, 'no component overrides the base focus specimen').toBeGreaterThan(0);

    for (const override of overrides) {
      const twin = override.selector.replace('[data-aa-state="focus"]', ':focus-within');
      const alternative = override.selector.replace('[data-aa-state="focus"]', ':focus-visible');
      const real = rules.find(
        (rule) =>
          rule.selector.trim() === twin.trim() || rule.selector.trim() === alternative.trim()
      );

      expect(
        real,
        `${override.selector} styles the specimen with no matching real-focus rule, so the guide ` +
          'is the only place this state exists'
      ).toBeDefined();
      expect(
        fingerprint(override.block),
        `${override.selector} drifted from ${real?.selector}`
      ).toBe(fingerprint(real?.block ?? ''));
    }
  });
});
