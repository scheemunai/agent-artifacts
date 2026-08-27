import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sanitizeMarkdownHtml } from '../../src/lib/sanitize.js';
import { parseStylesheet } from '../support/css-cascade.js';

/**
 * A-41: a dead control must not wear a live costume.
 *
 * The sanitizer does the right thing with a hostile link — it strips the href and leaves the text —
 * but the stripped anchor kept `.aa-md a`'s accent colour, so what remains looks like a link, in
 * the product's own link colour, and differs from a working one only by an underline that appears
 * on hover. A reader cannot tell those apart before clicking, and clicking teaches them nothing.
 * C14's no-dead-affordance rule, in miniature.
 *
 * The rule lives in viewer scope: `.aa-md a` belongs to app.css, which is another lane's file this
 * round, and prose rendered inside a dashboard card is not this defect. Scoping it to the viewer
 * also states the claim honestly — this is about the surface where strangers' markdown is read.
 */

const viewerCss = readFileSync(
  fileURLToPath(new URL('../../src/ui/assets/viewer.css', import.meta.url)),
  'utf8'
);

describe('an anchor the sanitizer disarmed', () => {
  it('is what the sanitizer actually produces: text with no href', () => {
    const html = sanitizeMarkdownHtml('<p><a href="javascript:alert(1)">unsafe</a></p>');

    // The premise the styling rule rests on. If the sanitizer ever started dropping the element
    // instead of the attribute, this fails and the rule below becomes dead code rather than a
    // silent no-op.
    expect(html).toContain('<a');
    expect(html).toContain('unsafe');
    expect(html).not.toContain('href');
  });

  it('is styled as text in the viewer, not as a link', () => {
    const rules = parseStylesheet(viewerCss).filter((rule) =>
      rule.selector.includes('a:not([href])')
    );

    expect(rules.length, 'no viewer rule styles href-less anchors').toBeGreaterThan(0);

    const block = rules.map((rule) => rule.block).join(' ');
    // Not accent-coloured, and no underline appearing on hover to suggest something will happen.
    expect(block).toMatch(/color:/);
    expect(block).not.toContain('--color-aa-accent');
    expect(block).toMatch(/text-decoration:\s*none/);

    // The hover state has to be covered too, or the costume returns the moment a cursor arrives.
    expect(
      rules.some((rule) => rule.selector.includes(':hover')),
      'the hover state must be neutralised as well'
    ).toBe(true);
  });

  it('stays scoped to the viewer, leaving app.css to its owner', () => {
    const scoped = parseStylesheet(viewerCss)
      .filter((rule) => rule.selector.includes('a:not([href])'))
      .every((rule) => rule.selector.includes('.aa-viewer'));

    expect(scoped, 'the rule must not reach beyond the viewer surface').toBe(true);
  });
});
