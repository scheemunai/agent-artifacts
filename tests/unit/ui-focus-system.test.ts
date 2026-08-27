import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseStylesheet, resolveVars, themeVariables } from '../support/css-cascade.js';

/**
 * V2-N9 / V2-N10. The focus treatment was one hardcoded accent ring applied to everything that
 * could take focus, and it broke in two directions at once:
 *
 *  - a success-green revoke notice wore an accent-RED ring, so the one element on screen telling
 *    someone their action succeeded was outlined in the product's danger-adjacent colour;
 *  - the drawer panel, which is focused programmatically for focus management rather than aimed at,
 *    painted a full ring on a box flush to the viewport edge — visible only as an orphaned accent
 *    line down the panel edge, an artefact with no apparent cause.
 *
 * Both are the same defect: a ring that knows nothing about the surface it lands on. The fix is one
 * variable the surface can set, not a rule per instance — otherwise the next toned component
 * reintroduces it.
 */
const css = readFileSync('src/ui/assets/app.css', 'utf8');
const rules = parseStylesheet(css);
const theme = themeVariables(css);

function block(selector: string): string {
  return (
    rules.find((rule) =>
      rule.selector
        .split(',')
        .map((part) => part.trim())
        .includes(selector)
    )?.block ?? ''
  );
}

const TONES = ['info', 'success', 'warn', 'danger'];

describe('focus treatment adapts to the surface it lands on', () => {
  it('draws the ring from a variable rather than a fixed accent', () => {
    const base = block(':focus-visible');

    expect(base, 'no global focus rule').not.toBe('');
    expect(base, 'the focus ring is hardcoded to one colour').toContain('--color-aa-focus');
    expect(theme.get('--color-aa-focus'), 'no focus colour token').toBeDefined();
    // The soft halo has to follow the ring, or a retoned focus shows a green outline with a red
    // glow. Asserted on the token as authored: resolving it would substitute the variable away,
    // which is precisely the thing being checked for.
    expect(theme.get('--shadow-aa-focus'), 'the focus halo is a fixed colour').toContain(
      'var(--color-aa-focus)'
    );
    // And it must resolve to a real colour, so the assertion above is not satisfied by a typo.
    expect(resolveVars(theme.get('--shadow-aa-focus') ?? '', theme)).toMatch(/#[0-9a-f]{6}/i);
  });

  it('lets every toned surface retone its own focus ring', () => {
    for (const tone of TONES) {
      const rule = block(`.aa-notice--${tone}`);
      expect(rule, `.aa-notice--${tone} is missing`).not.toBe('');
      expect(rule, `${tone} notices still focus in the accent colour`).toContain(
        '--color-aa-focus'
      );
    }
  });

  it('does not ring a container that was focused for it', () => {
    // `tabindex="-1"` is not reachable by Tab, so anything matching this was moved into focus by
    // script — a drawer panel, a dialog, a notice announced on load. The user did not aim at it and
    // does not need it outlined; the ring only produced the edge artefact.
    const managed = block('[tabindex="-1"]:focus-visible');

    expect(managed, 'programmatic focus targets still paint a ring').not.toBe('');
    expect(managed).toContain('outline: none');
    expect(managed).toContain('box-shadow: none');
  });
});
