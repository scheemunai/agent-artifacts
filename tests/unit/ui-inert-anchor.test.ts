import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sanitizeMarkdownHtml } from '../../src/lib/sanitize.js';
import { type ElementSpec, parseStylesheet, winningDeclaration } from '../support/css-cascade.js';

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
/** Read-only: this suite asserts a relationship with another lane's file, it never writes it. */
const appCss = readFileSync(
  fileURLToPath(new URL('../../src/ui/assets/app.css', import.meta.url)),
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

/**
 * The cross-lane contract, asserted as a relationship rather than as an existence.
 *
 * The rule above only helps if it still *wins* over `.aa-md a`, and that selector lives in app.css —
 * another lane's file, actively being reshaped. "My rule exists" is not the claim that matters;
 * "my rule beats theirs for a disarmed anchor, and loses to theirs for a live one" is. So this
 * resolves the real cascade across both stylesheets in their real load order and reads the winner.
 *
 * If a restructure in app.css breaks the relationship, this fails at that lane's own commit
 * boundary. That is the intent: a contract test failing in the file that broke it is a
 * renegotiation, not an accusation — the alternative is discovering it in a screenshot two rounds
 * later, which is how this defect got here in the first place.
 *
 * It reads app.css and never writes it.
 */
describe('the viewer/app.css anchor contract', () => {
  const appRules = parseStylesheet(appCss);
  const rules = [...appRules, ...parseStylesheet(viewerCss, appRules.length)];

  // section.aa-viewer-content > div.aa-prose-page > .aa-md > a — the document's real shape, and the
  // load order the viewer document emits: app.css first, viewer.css second.
  const inViewerProse = (anchor: ElementSpec): ElementSpec[] => [
    { tag: 'section', classes: ['aa-viewer-content'] },
    { tag: 'div', classes: ['aa-prose-page'] },
    { tag: 'div', classes: ['aa-md'] },
    anchor,
  ];

  const DISARMED: ElementSpec = { tag: 'a' };
  const LIVE: ElementSpec = { tag: 'a', attributes: { href: 'https://example.test' } };

  it('gives a disarmed anchor the viewer rule, not the link colour', () => {
    const winner = winningDeclaration(rules, inViewerProse(DISARMED), 'color', 1440);

    expect(winner, 'nothing styles a disarmed anchor at all').toBeDefined();
    expect(
      winner?.rule.selector,
      'app.css now outranks the viewer rule — a stripped link wears the live colour again'
    ).toContain('a:not([href])');
    expect(winner?.value).not.toContain('--color-aa-accent');
  });

  it('leaves a working link alone', () => {
    const winner = winningDeclaration(rules, inViewerProse(LIVE), 'color', 1440);

    // The other half of the contract, and the one a careless fix breaks: real links must keep
    // reading as links.
    expect(winner?.value, 'the viewer rule has bled onto live links').toContain(
      '--color-aa-accent'
    );
  });

  it('does not underline what it just made inert', () => {
    const winner = winningDeclaration(rules, inViewerProse(DISARMED), 'text-decoration', 1440);

    expect(winner?.value).toContain('none');
  });
});
