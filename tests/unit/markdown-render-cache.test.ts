import { describe, expect, it } from 'vitest';
import {
  clearMarkdownRenderCache,
  getMarkdownRenderCacheStats,
  renderMarkdown,
} from '../../src/lib/markdown.js';
import { LruCache } from '../../src/lib/render-cache.js';

describe('markdown rendering and render cache', () => {
  it('renders GFM markdown with breaks disabled and wraps sanitized output', () => {
    const html = renderMarkdown('| A | B |\n| - | - |\n| 1 | 2 |\n\none\ntwo', {
      contentHash: 'gfm-table-breaks-off',
    });

    expect(html).toContain('<article class="aa-md">');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('one\ntwo');
    expect(html).not.toContain('<br>two');
  });

  it('reuses rendered HTML by content hash', () => {
    clearMarkdownRenderCache();

    const first = renderMarkdown('# One', { contentHash: 'same-content-hash' });
    const second = renderMarkdown('# Two', { contentHash: 'same-content-hash' });

    expect(second).toBe(first);
    expect(getMarkdownRenderCacheStats()).toMatchObject({ entries: 1 });
  });

  it('keys rendered HTML by heading offset to avoid dashboard/viewer cache poisoning', () => {
    clearMarkdownRenderCache();

    const publicHtml = renderMarkdown('# Cache Heading', { contentHash: 'heading-offset-cache' });
    const dashboardHtml = renderMarkdown('# Cache Heading', {
      contentHash: 'heading-offset-cache',
      headingOffset: 1,
    });

    expect(publicHtml).toContain('<h1>Cache Heading</h1>');
    expect(dashboardHtml).toContain('<h2>Cache Heading</h2>');
    expect(getMarkdownRenderCacheStats()).toMatchObject({ entries: 2 });
  });

  it('evicts least-recently-used entries by byte cap without external dependencies', () => {
    const cache = new LruCache<string>({ maxBytes: 4, sizeOf: (value) => value.length });

    expect(cache.set('a', 'aa')).toBe(true);
    expect(cache.set('b', 'bb')).toBe(true);
    expect(cache.get('a')).toBe('aa');
    expect(cache.set('c', 'cc')).toBe(true);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('aa');
    expect(cache.get('c')).toBe('cc');
    expect(cache.stats()).toMatchObject({ entries: 2, bytes: 4, maxBytes: 4 });
  });

  it('does not retain entries larger than the cache byte cap', () => {
    const cache = new LruCache<string>({ maxBytes: 4, sizeOf: (value) => value.length });

    expect(cache.set('huge', '12345')).toBe(false);
    expect(cache.get('huge')).toBeUndefined();
    expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
  });
});
