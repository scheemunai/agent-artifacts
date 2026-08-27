import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  Button,
  CopyBlock,
  Input,
  NavShell,
  Table,
} from '../../src/ui/components/primitives.js';
import { StyleGuidePage } from '../../src/ui/pages/style-guide.js';

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
    const copy = renderToString(
      CopyBlock({ id: 'copy-me', label: 'Install prompt', value: 'POST /v1/artifacts' })
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
});

describe('ui css contract', () => {
  const css = readFileSync('src/ui/assets/app.css', 'utf8');

  it('defines tokens in Tailwind v4 theme and keeps downstream colors tokenized', () => {
    expect(css).toContain('@theme');
    expect(css).toContain('--color-aa-accent:');
    expect(css).toContain('--spacing-aa-touch:');
    expect(stripTheme(css)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('has mobile-safe table and drawer rules', () => {
    expect(css).toContain('.aa-table-scroll');
    expect(css).toContain('overflow-x: auto');
    expect(css).toMatch(/\.aa-section\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(
      /\.aa-section > \*,[\s\S]*?\.aa-section-header > \*\s*{[\s\S]*?min-width: 0;/
    );
    expect(css).toMatch(/\.aa-stack\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(/\.aa-stack > \*\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(/\.aa-grid\s*{[\s\S]*?min-width: 0;/);
    expect(css).toMatch(/\.aa-grid > \*\s*{[\s\S]*?min-width: 0;/);
    expect(css).toContain('grid-template-columns: minmax(0, 80vw) 1fr');
    expect(css).toContain('scrollbar-color: var(--color-aa-line-strong) var(--color-aa-surface)');
  });

  it('keeps markdown-rendered code and tables inside their own scroll surfaces', () => {
    expect(css).toContain('.aa-md pre');
    expect(css).toMatch(/\.aa-md pre\s*{[\s\S]*?overflow-x: auto;/);
    expect(css).toMatch(/\.aa-md pre code\s*{[\s\S]*?width: max-content;/);
    expect(css).toMatch(/\.aa-md table\s*{[\s\S]*?display: block;[\s\S]*?overflow-x: auto;/);
    expect(css).toContain('.aa-md .aa-md-table-scroll table');
    expect(css).toMatch(
      /@media \(max-width: 480px\)[\s\S]*?\.aa-md[\s\S]*?padding-inline: var\(--spacing-aa-4\)/
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
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
    expect(html).toContain('class="aa-md"');
    expect(html).toContain('raw markdown tables scroll inside themselves at 375px');
    expect(html).toContain('<script type="module" src="/assets/ui-foundation-');
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[\s\S]*?>[\s\S]*?<\/script>/i);
    expect(html).not.toMatch(/https?:\/\/(cdn|unpkg|jsdelivr|fonts\.googleapis)/i);
  });
});
