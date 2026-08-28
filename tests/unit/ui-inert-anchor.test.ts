import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sanitizeMarkdownHtml } from '../../src/lib/sanitize.js';
import {
  type ElementSpec,
  parseStylesheet,
  specificity,
  winningDeclaration,
} from '../support/css-cascade.js';

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
 * ── WHAT THE RELATIONSHIP ACTUALLY RESTS ON ────────────────────────────────────────────────────
 *
 * It holds on SPECIFICITY, not on source order:
 *
 *     .aa-viewer-content .aa-md a:not([href])   (0,3,1)
 *     .aa-md a                                  (0,1,1)
 *
 * `:not()` contributes nothing itself, but ITS ARGUMENT COUNTS — `[href]` scores in the class
 * column, which is the term most often dropped in a hand count and is worth two of the three
 * columns of margin here.
 *
 * So reordering app.css cannot disturb this, and neither can a rule that merely ties: at (0,3,1)
 * the win goes to viewer.css, which loads second. It breaks only if a NEW rule reaches viewer prose
 * anchors while STRICTLY EXCEEDING (0,3,1) — a much narrower and more visible thing to do by
 * accident than a restructure. If this suite reds at another lane's boundary, the first question is
 * therefore not "did app.css get reordered" (order cannot do it) but "did a new rule start reaching
 * viewer prose".
 *
 * It reads app.css and never writes it.
 */
describe('the viewer/app.css anchor contract', () => {
  /**
   * Stacks the two sheets in the order the viewer document emits them: app.css, then viewer.css.
   *
   * The offset is `last order + 1`, NOT `appRules.length`, and the difference is not cosmetic.
   * Rule orders are not dense — app.css parses to 445 rules whose highest order is 814 — so seeding
   * the viewer sheet at the app sheet's *count* left 201 late app.css rules holding orders at or
   * above every viewer rule, i.e. modelled as loading AFTER the sheet that actually loads last.
   * The contract below still returned the right answers, which is the dangerous part: it was green
   * for a reason that did not correspond to the browser, and the protection it advertises was void
   * for exactly the half of app.css where the late rules live.
   */
  const stackedSheets = (appSource: string) => {
    const appRules = parseStylesheet(appSource);
    return [...appRules, ...parseStylesheet(viewerCss, (appRules.at(-1)?.order ?? 0) + 1)];
  };

  const rules = stackedSheets(appCss);

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

  /**
   * The contract holds on SPECIFICITY, not on source order — and this proves the order half is
   * modelled correctly anyway, because the moment it is not, the specificity claim is being read
   * out of a stack the browser would not recognise.
   *
   * The intruder ties the viewer rule exactly, so specificity cannot decide it and order is the
   * only tie-break left. A browser gives it to viewer.css, which loads second. This test is the one
   * that catches an offset that silently reverses the two sheets — the assertions above cannot,
   * because they are decided before the tie-break is ever reached.
   */
  it('resolves the two sheets in their real load order', () => {
    const intruder = '.aa-viewer-content .aa-prose-page .aa-md a';
    const viewerRule = '.aa-viewer-content .aa-md a:not([href])';

    // The premise: a genuine tie. If this ever stops being equal the test below proves nothing,
    // so it is asserted rather than assumed.
    expect(specificity(intruder)).toEqual(specificity(viewerRule));

    const winner = winningDeclaration(
      stackedSheets(`${appCss}\n${intruder} { color: var(--color-aa-accent); }\n`),
      inViewerProse(DISARMED),
      'color',
      1440
    );

    expect(
      winner?.rule.selector,
      'an app.css rule is winning a tie it should lose — the sheets are stacked in the wrong order'
    ).toContain('a:not([href])');
  });
});
