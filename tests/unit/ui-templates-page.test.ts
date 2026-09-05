import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_CATEGORIES } from '../../src/lib/schemas/templates.js';
import { loadStarterTemplates } from '../../src/services/templates.js';
import { TEMPLATE_CATEGORY_COPY } from '../../src/ui/copy/template-categories.js';
import { TemplateDetailPage, TemplatesPage } from '../../src/ui/pages/templates.js';
import { compiledAppRules } from '../support/compiled-stylesheet.js';
import { type ElementSpec, winningDeclaration } from '../support/css-cascade.js';

/**
 * The public gallery is a marketing surface rendered from product data, which is the same shape as
 * the legal pages — and those shipped illegible because nothing ever opened them. This file and the
 * e2e that visits `/templates` are the two halves of not repeating that: the browser proves what a
 * visitor receives, and this proves the stylesheet a visitor receives actually styles it.
 *
 * Resolved against the COMPILED sheet, because the compiled preflight is where the resets live and
 * a source-only check cannot see them.
 */
const rules = compiledAppRules();
const templates = loadStarterTemplates();

function served(path: ElementSpec[], property: string, width = 1440): string | undefined {
  return winningDeclaration(rules, path, property, width)?.value;
}

const page: ElementSpec[] = [{ tag: 'main', classes: ['aa-main', 'aa-shell', 'aa-templates'] }];

describe('every category the enum offers is a category the page can render', () => {
  it('gives all six a label and a blurb', () => {
    for (const category of TEMPLATE_CATEGORIES) {
      const copy = TEMPLATE_CATEGORY_COPY[category];
      expect(copy?.label, `${category} has no label`).toBeTruthy();
      expect(copy?.blurb, `${category} has no blurb`).toBeTruthy();
      // The blurb answers "why open this section". A restated label says nothing.
      expect(copy.blurb).not.toBe(copy.label);
      expect(copy.blurb.length).toBeGreaterThan(20);
    }
  });

  it('gives every shipped template a category the page groups by', () => {
    // A template whose category the page does not know is a template that renders nowhere.
    for (const template of templates) {
      expect(
        TEMPLATE_CATEGORIES as readonly string[],
        `${template.slug} has category ${template.category}, which no section renders`
      ).toContain(template.category);
    }
  });
});

describe('the gallery is grouped, and the grouping survives to the browser', () => {
  const html = renderToString(TemplatesPage({ templates }));

  it('renders a section per non-empty category and none for the empty ones', () => {
    const rendered = new Set(
      Array.from(html.matchAll(/id="category-([a-z]+)"/g), (match) => String(match[1]))
    );
    const expected = new Set(templates.map((template) => template.category as string));
    expect([...rendered].sort()).toEqual([...expected].sort());
  });

  it('links every card to its own page and shows its thumbnail', () => {
    for (const template of templates) {
      expect(html, `${template.slug} has no card link`).toContain(
        `href="/templates/${template.slug}"`
      );
      if (template.thumbnail) {
        expect(html, `${template.slug} renders no thumbnail`).toContain(template.thumbnail);
      }
    }
  });

  it('carries one h1 and no skipped heading levels', () => {
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/<h2 class="aa-templates__group-title"/);
    expect(html).not.toMatch(/<h4\b/);
  });
});

describe('the compiled stylesheet actually styles the gallery', () => {
  it('sizes a category heading above the prose beneath it', () => {
    const heading: ElementSpec[] = [
      ...page,
      { tag: 'section', classes: ['aa-templates__group'] },
      { tag: 'h2', classes: ['aa-templates__group-title'] },
    ];
    const note: ElementSpec[] = [
      ...page,
      { tag: 'section', classes: ['aa-templates__group'] },
      { tag: 'p', classes: ['aa-templates__group-note'] },
    ];

    // The preflight sets `h1..h6 { font-size: inherit }`. A heading that answers `inherit` here is
    // the legal-page defect wearing a different class name.
    expect(served(heading, 'font-size')).toBeDefined();
    expect(served(heading, 'font-size')).not.toBe('inherit');
    expect(served(heading, 'font-size')).not.toBe(served(note, 'font-size'));
    expect(served(heading, 'font-weight')).not.toBe('inherit');
  });

  it('lays the cards out as a grid that cannot widen the page', () => {
    const grid: ElementSpec[] = [
      ...page,
      { tag: 'section', classes: ['aa-templates__group'] },
      { tag: 'ul', classes: ['aa-templates__grid'] },
    ];

    expect(served(grid, 'display')).toBe('grid');
    // `minmax(min(100%, …))` is the whole reason a 17rem minimum cannot overflow a 390px phone.
    expect(served(grid, 'grid-template-columns')).toContain('min(100%');
    // And the list markers the preflight removes are not wanted back on a card grid.
    expect(served(grid, 'list-style-type')).toBe('none');
  });

  it('reserves the thumbnail box so a missing image cannot reflow the grid', () => {
    const cover: ElementSpec[] = [...page, { tag: 'span', classes: ['aa-templates__cover'] }];
    // Whitespace-insensitive: the minifier writes `16/10`, the source writes `16 / 10`, and the
    // reserved box is the same either way.
    expect(served(cover, 'aspect-ratio')?.replace(/\s+/g, '')).toBe('16/10');
  });

  it('bounds the preview and says so, rather than clipping in silence', () => {
    const box: ElementSpec[] = [{ tag: 'div', classes: ['aa-templates__preview-box'] }];
    const frame: ElementSpec[] = [...box, { tag: 'iframe', classes: ['aa-templates__frame'] }];

    expect(served(frame, 'height')).toContain('clamp(');
    expect(served(box, 'overflow')).toBe('hidden');
    // The fade that says there is more, and the note beside it, are the affordance. A bounded box
    // with neither is the defect this product spent a week removing from its own viewer.
    // One colon or two: the minifier emits the legacy `:after` spelling, and both mean the same
    // generated box.
    const fade = rules.find((rule) =>
      /\.aa-templates__preview-box::?after/.test(rule.selector.replace(/\s+/g, ''))
    );
    expect(fade, 'the preview clips with no fade').toBeDefined();
    expect(fade?.block.replace(/\s+/g, '')).toContain('pointer-events:none');
  });
});

describe('a template detail page renders what the template actually is', () => {
  it('frames an HTML template in the same sandbox a published artifact uses', () => {
    const html = templates.find((template) => template.type === 'html');
    expect(html, 'no html starter to check').toBeDefined();
    // The URL is the caller's to choose — which host serves the frame is a property of the
    // deployment, and `tests/integration/template-frame-origin.test.ts` is where both shapes are
    // held against the CSP that ships with the page. Here it is a fixture, so this stays a test
    // about what the page renders around it.
    const frameUrl = `https://usercontent.example.test/templates/${html?.slug}/frame`;
    const rendered = renderToString(TemplateDetailPage({ template: html as never, frameUrl }));

    expect(rendered).toContain(`src="${frameUrl}"`);
    expect(rendered).toContain('sandbox="allow-scripts"');
    expect(rendered).not.toContain('allow-same-origin');
    expect(rendered).toContain('aa-templates__preview-note');
  });

  it('renders a markdown template inline, with no frame at all', () => {
    const markdown = templates.find((template) => template.type === 'markdown');
    expect(markdown, 'no markdown starter to check').toBeDefined();
    const rendered = renderToString(
      TemplateDetailPage({
        template: markdown as never,
        frameUrl: `https://usercontent.example.test/templates/${markdown?.slug}/frame`,
      })
    );

    // Markdown has no sandbox problem and the frame origin could not load the stylesheet anyway.
    expect(rendered).toContain('aa-templates__markdown');
    expect(rendered).not.toContain('aa-templates__frame');
    expect(rendered).toContain('aa-md');
  });
});
