import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  Button,
  CopyBlock,
  Input,
  NavShell,
  Pagination,
  Table,
  Toast,
} from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';
import { readClientSource } from '../support/client-assets.js';

function stripTheme(css: string): string {
  return css.replace(/@theme\s*{[\s\S]*?}\n\n@layer base/, '@layer base');
}

describe('ui component primitives', () => {
  it('renders button loading and disabled states with semantic attributes', () => {
    const loading = renderToString(
      Button({ children: 'Saving…', variant: 'primary', loading: true })
    );
    const disabled = renderToString(
      Button({ children: 'Delete', variant: 'danger', disabled: true })
    );

    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain('disabled');
    expect(loading).toContain('role="status"');
    expect(disabled).toContain('aa-btn--danger');
    expect(disabled).toContain('disabled');
  });

  it('passes explicit labels and tooltips through to icon-only buttons', () => {
    const html = renderToString(
      Button({
        children: '↻',
        variant: 'ghost',
        ariaLabel: 'Refresh artifact',
        title: 'Refresh artifact',
      })
    );

    expect(html).toContain('aria-label="Refresh artifact"');
    expect(html).toContain('title="Refresh artifact"');
  });

  it('wires form labels, hints, errors, and invalid state accessibly', () => {
    const html = renderToString(
      Input({
        id: 'slug',
        label: 'Slug',
        hint: 'Use lowercase letters.',
        error: 'Use hyphens instead of spaces.',
        state: 'error',
      })
    );

    expect(html).toContain('<label class="aa-label" for="slug">Slug</label>');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="slug-hint slug-error"');
    expect(html).toContain('id="slug-error"');
  });

  it('keeps badges inline and tables contained in their own scroll container', () => {
    const badge = renderToString(Badge({ tone: 'success', children: 'Live' }));
    const table = renderToString(
      Table({ columns: ['Title', 'Status'], rows: [['Weekly report', 'Shared']] })
    );

    expect(badge).toContain('aa-badge--success');
    expect(badge).not.toContain('w-full');
    expect(table).toContain('aa-table-scroll');
    expect(table).toContain('tabindex="0"');
  });

  it('hydrates copy blocks and the mobile drawer with data attributes, not inline handlers', () => {
    // A real install prompt is many lines, and only a multi-line block can actually scroll —
    // the hint is now conditional on that, so the fixture has to be honest about its shape.
    const copy = renderToString(
      CopyBlock({
        id: 'copy-me',
        label: 'Install prompt',
        value: 'POST /v1/artifacts\nAuthorization: Bearer [KEY]\n\n{ "title": "…" }',
      })
    );
    const nav = renderToString(
      NavShell({ items: [{ label: 'Style guide', href: '/style-guide' }] })
    );

    expect(copy).toContain('data-aa-copy="copy-me"');
    expect(copy).toContain('aria-describedby="copy-me-hint"');
    expect(copy).toContain('Scroll inside the block to view everything');
    expect(nav).toContain('data-aa-drawer="true"');
    expect(`${copy}${nav}`).not.toMatch(/on(click|submit|keydown)=/i);
  });

  it('does not claim a single-line copy block scrolls', () => {
    const copy = renderToString(
      CopyBlock({ id: 'copy-one', label: 'API key', value: 'aa_bot_0123456789' })
    );

    expect(copy).toContain('data-aa-copy="copy-one"');
    // The hint is present but `hidden`, not absent. Same visible outcome — nothing claims this
    // block scrolls — but the element exists so the client's measurement has something to reveal
    // when a long credential overflows sideways, and so `aria-describedby` never dangles. A hidden
    // target is correctly ignored by assistive tech. See ui-copy-block-affordance.test.ts.
    expect(copy).toMatch(/<p class="aa-copy__hint"[^>]*hidden/);
  });

  it('renders dismissible server toasts and specimen pagination feedback hooks', () => {
    const toast = renderToString(Toast({ tone: 'info', children: 'Public viewer refreshed.' }));
    const pagination = renderToString(
      Pagination({
        label: 'Artifact pages',
        pageDescription: 'Showing 1–20',
        previousDataAttrs: { 'data-aa-toast-trigger': 'true' },
        nextDataAttrs: { 'data-aa-toast-trigger': 'true' },
      })
    );

    expect(toast).toContain('data-aa-toast-close="true"');
    expect(toast).toContain('aria-label="Dismiss toast"');
    expect(pagination.match(/data-aa-toast-trigger="true"/g) ?? []).toHaveLength(2);
  });
});

describe('ui css contract', () => {
  const css = readFileSync('src/ui/assets/app.css', 'utf8');

  it('defines tokens in Tailwind v4 theme and keeps downstream colors tokenized', () => {
    expect(css).toContain('@theme');
    expect(css).toContain('--color-aa-accent:');
    expect(css).toContain('--spacing-aa-touch:');
    expect(css).toContain('font-family: "Source Sans 3"');
    expect(css).toContain('source-sans-3-latin-var.woff2');
    expect(css).toContain('--color-aa-dark-card:');
    expect(css).toContain('--shadow-aa-card:');
    expect(stripTheme(css)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('has mobile-safe table and drawer rules', () => {
    expect(css).toContain('.aa-table-scroll');
    expect(css).toContain('.aa-marketing-artifact');
    expect(css).toContain('.aa-marketing-grid');
    expect(css).toContain('overflow-x: auto');
    expect(css).toMatch(/\.aa-section\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(
      /\.aa-section > \*,[\s\S]*?\.aa-section-header > \*\s*{[\s\S]*?min-width: 0;/
    );
    expect(css).toMatch(/\.aa-stack\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(/\.aa-stack > \*\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(/\.aa-grid\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(/\.aa-grid\s*{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
    expect(css).toMatch(/\.aa-grid > \*\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.aa-grid--2,[\s\S]*?\.aa-grid--3\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
    );
    // Capped at the panel's own width so the scrim covers everything the panel does not; see
    // `tests/unit/ui-cascade-contract.test.ts` for the geometry proof.
    expect(css).toContain('grid-template-columns: min(80vw, var(--width-aa-drawer)) 1fr');
    expect(css).toMatch(/html\.aa-lock-scroll,[\s\S]*?body\.aa-lock-scroll\s*{/);
    expect(css).toContain('overscroll-behavior: none');
    expect(css).toContain('scrollbar-color: var(--color-aa-line-strong) var(--color-aa-surface)');
  });

  it('keeps markdown-rendered code and tables inside their own scroll surfaces', () => {
    expect(css).toContain('.aa-md pre');
    expect(css).toMatch(/\.aa-md pre\s*{[^{}]*overflow-x: auto;/);
    expect(css).toMatch(/\.aa-md pre code\s*{[^{}]*width: max-content;/);

    // THE TABLE STOPPED BEING ITS OWN SCROLL CONTAINER, AND THAT IS THE FIX.
    //
    // This used to assert `.aa-md table { display: block; overflow-x: auto }` — the shape that
    // made the table scroll itself. It did scroll, and it was also the defect: a block box at
    // `width: 100%` with table layout inside draws its border at the column width while the cells
    // stop at their content width, so every markdown table in the product carried a wide empty
    // band inside its own border. A test can pin a defect as easily as a contract, and this one
    // did, for as long as the rule existed.
    //
    // Scoped with `[^{}]*` rather than `[\s\S]*?`, which crossed block boundaries and would have
    // let the negative assertion below pass on a `display: block` belonging to some other rule.
    expect(css).toMatch(/\.aa-md \.aa-md-table-scroll\s*{[^{}]*overflow-x: auto;/);
    expect(css).not.toMatch(/\.aa-md table\s*{[^{}]*display: block;/);
    expect(css).toMatch(/\.aa-md table\s*{[^{}]*width: max-content;[^{}]*min-width: 100%;/);
    // Mobile inset belongs to the reading column, not to the prose scope: `.aa-md` is embedded in
    // already-padded cards. See `tests/unit/ui-prose-scope.test.ts` for the resolved proof.
    expect(css).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.aa-prose-page\s*\{\s*padding-inline: var\(--spacing-aa-4\)/
    );
  });

  it('keeps compact controls at the shared 44px touch target floor', () => {
    expect(css).toMatch(/\.aa-btn--sm\s*{[\s\S]*?min-height: var\(--spacing-aa-touch\)/);
    expect(css).toContain('--spacing-aa-touch: 2.75rem;');
  });

  it('makes copy blocks scrollable with a visible affordance', () => {
    expect(css).toContain('.aa-copy pre');
    expect(css).toContain('max-height: min(32rem, 62vh)');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('scrollbar-gutter: stable');
    expect(css).toContain('.aa-copy__hint::before');
  });
});

describe('style guide page', () => {
  it('renders tokens, every primitive family, markdown sample, and no inline executable script', () => {
    const html = renderToString(StyleGuidePage());

    for (const text of [
      'Design tokens',
      'Fresh Air marketing components',
      'Button',
      'Inputs',
      'Badge',
      'Table',
      'Dialogs',
      'Toast',
      'Empty state',
      'Copy block',
      'Scrollable install prompt',
      'Tabs and pagination',
      'Avatar, mark, spinner, skeleton',
      'Markdown artifact theme',
    ]) {
      expect(html).toContain(text);
    }

    expect(html).toContain('Agent Artifacts Style Guide');
    expect(html).toContain('this-is-artifact');
    expect(html).toContain('style-guide-marketing-api');
    expect(html).toContain('/skill.md');
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).toContain('Specimen controls announce a toast when clicked');
    expect(html).toContain('Skeleton is specimen-only, not for production use.');
    expect(html).toContain('class="aa-md"');
    // Was `'raw markdown tables scroll inside themselves at 375px'`, which described the defect:
    // the guide's own specimen was an unwrapped table captioned as proof of the behaviour that
    // drew the stretched border box. The renderer wraps every table now, and the guide shows what
    // it emits.
    expect(html).toContain('aa-md-table-scroll');
    expect(html).toContain('never reads as broken content');
    expect(html).toContain('<script type="module" src="/assets/ui-foundation-');
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[\s\S]*?>[\s\S]*?<\/script>/i);
    expect(html).not.toMatch(/https?:\/\/(cdn|unpkg|jsdelivr|fonts\.googleapis)/i);
  });

  it('wires style-guide specimen controls to visible feedback and toast dismissal', () => {
    const html = renderToString(StyleGuidePage());
    const foundationScript = readClientSource('ui-foundation.js');

    expect(html).toContain('data-aa-toast-message="default button specimen."');
    expect(html).toContain(
      'data-aa-toast-message="Card action specimen. Production cards wire a real action."'
    );
    expect(html).toContain('data-aa-toast-close="true"');
    expect(foundationScript).toMatch(
      /closest\([\s\S]*data-aa-toast-close[\s\S]*aria-label="Dismiss toast"[\s\S]*\)/
    );
    expect(foundationScript).toContain("document.body.classList.add('aa-lock-scroll')");
    expect(foundationScript).toContain("document.body.classList.remove('aa-lock-scroll')");
  });
});
