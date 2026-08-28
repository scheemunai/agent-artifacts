import { describe, expect, it } from 'vitest';
import { nextOrder, parseStylesheet, winningDeclaration } from '../support/css-cascade.js';

/**
 * The resolver decides nearly every CSS assertion in this suite, and until now nothing decided the
 * resolver. This covers the one part of it callers have to operate by hand: stacking a second
 * stylesheet after a first.
 *
 * The trap is that ORDERS ARE NOT DENSE. `collectRules` increments once per selector and once more
 * per rule block, so a sheet of three rules ends at order 4, not 3. `rules.length` looks like the
 * next free slot and is not one — it points back INSIDE the first sheet. Seeding the second sheet
 * there interleaves the two, and the interleaving is invisible: nothing throws, every rule is still
 * present, and the only thing that changes is who wins a source-order tie. A tie is precisely when
 * order is load-bearing, so the bug can only show up in the case the offset exists to handle.
 *
 * Both halves are pinned below — that the wrong idiom really does produce the wrong winner, and
 * that `nextOrder` produces the right one. Asserting only the second would leave a passing test
 * that never demonstrates there was anything to fix.
 */
const APP = `
  .a { color: one; }
  .b { color: two; }
  .target { color: red; }
`;
const LATER = `.target { color: green; }`;

const target = [{ tag: 'div', classes: ['target'] }];
const winner = (rules: ReturnType<typeof parseStylesheet>) =>
  winningDeclaration(rules, target, 'color', 1440)?.value;

describe('stacking a second stylesheet', () => {
  it('leaves gaps in the order, so the rule count is not the next free order', () => {
    const app = parseStylesheet(APP);
    expect(app).toHaveLength(3);

    const orders = app.map((rule) => rule.order);
    expect(orders, 'orders are dense after all — this file is guarding nothing').not.toEqual([
      0, 1, 2,
    ]);
    expect(nextOrder(app)).toBeGreaterThan(app.length);
  });

  it('resolves the later sheet as the winner of a source-order tie', () => {
    const app = parseStylesheet(APP);
    const stacked = [...app, ...parseStylesheet(LATER, nextOrder(app))];

    // Same specificity on both `.target` rules, so this is decided purely by order.
    expect(winner(stacked), 'the later stylesheet lost a tie it should have won').toBe('green');
  });

  it('demonstrates the defect the helper exists to prevent', () => {
    // The wrong idiom, kept executable rather than described in a comment: `rules.length` seeds the
    // second sheet at an order the first sheet is still using, and the first sheet wins.
    const app = parseStylesheet(APP);
    const interleaved = [...app, ...parseStylesheet(LATER, app.length)];

    expect(
      winner(interleaved),
      'seeding at rules.length no longer interleaves the sheets — if the order scheme changed, ' +
        'this file and nextOrder both need rereading rather than this line deleting'
    ).toBe('red');
  });

  it('survives a set that is filtered, concatenated or out of order', () => {
    // Why the maximum rather than `.at(-1).order + 1`: the latter silently requires the array to be
    // sorted ascending and non-empty, which is an assumption the caller should not have to hold.
    const app = parseStylesheet(APP);
    const shuffled = [...app].reverse();

    expect(nextOrder(shuffled)).toBe(nextOrder(app));
    expect(nextOrder([]), 'an empty sheet has to start somewhere').toBe(0);
    expect(nextOrder(app.filter((rule) => rule.selector !== '.target'))).toBeLessThan(
      nextOrder(app)
    );
  });
});
