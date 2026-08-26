import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown.js';
import { isSafeHref, isSafeImageSrc, sanitizeMarkdownHtml } from '../../src/lib/sanitize.js';

type HostileCase = {
  name: string;
  input: string;
  forbidden: RegExp[];
  assertNeutralized?: (html: string) => void;
};

const hostileCases: HostileCase[] = [
  {
    name: 'script tag',
    input: '<script>alert(1)</script><p>safe</p>',
    forbidden: [/<script\b/i, /alert\(1\)/i],
  },
  {
    name: 'image event handler',
    input: '<img src="https://example.com/a.png" onerror="alert(1)">',
    forbidden: [/onerror/i, /alert\(1\)/i],
  },
  {
    name: 'javascript href',
    input: '[click me](javascript:alert(1))',
    forbidden: [/href\s*=\s*["']?javascript:/i, /alert\(1\)/i],
  },
  {
    name: 'iframe tag',
    input: '<iframe src="https://evil.example/embed"></iframe>',
    forbidden: [/<iframe\b/i, /evil\.example/i],
  },
  {
    name: 'form tag',
    input: '<form action="/login"><input type="text" name="password" value="secret"></form>',
    forbidden: [/<form\b/i, /action=/i, /name=/i, /value=/i, /password/i, /secret/i],
  },
  {
    name: 'svg payload',
    input: '<svg><script>alert(1)</script><circle onload="alert(2)"></circle></svg>',
    forbidden: [/<svg\b/i, /<circle\b/i, /<script\b/i, /onload/i, /alert\(/i],
  },
  {
    name: 'data text html image',
    input: '<img src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" alt="x">',
    forbidden: [/data:text\/html/i, /PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==/i],
  },
  {
    name: 'DOM clobbering id and reserved aa classes',
    input: '<div id="aa-boot" name="constructor" class="aa-md safe aa-card">ok</div>',
    forbidden: [/id="aa-boot"/i, /name=/i, /class="safe aa-/i],
  },
  {
    name: 'deep blockquote nesting bomb',
    input: `${'> '.repeat(80)}deep`,
    forbidden: [],
    assertNeutralized: (html) => {
      const blockquoteCount = html.match(/<blockquote>/g)?.length ?? 0;
      expect(blockquoteCount).toBeLessThanOrEqual(32);
      expect(html).toContain('<article class="aa-md">');
    },
  },
] as const;

describe('markdown sanitizer hostile input suite', () => {
  it.each(hostileCases)('neutralizes $name', ({ input, forbidden, assertNeutralized }) => {
    const html = renderMarkdown(input, { contentHash: `hostile:${input}` });

    for (const pattern of forbidden) {
      expect(html).not.toMatch(pattern);
    }
    assertNeutralized?.(html);
  });

  it('prefixes content IDs while preserving non-reserved content classes', () => {
    const html = sanitizeMarkdownHtml('<div id="aa-boot" class="safe aa-md also-safe">ok</div>');

    expect(html).toContain('id="user-content-aa-boot"');
    expect(html).toContain('class="safe also-safe"');
    expect(html).not.toContain('class="safe aa-md');
  });

  it('forces GFM task-list inputs to disabled checkboxes only', () => {
    const renderedTask = renderMarkdown('- [x] done', { contentHash: 'task-list' });
    const sanitizedRawInput = sanitizeMarkdownHtml('<input type="text"><input type="checkbox">');

    expect(renderedTask).toContain('type="checkbox"');
    expect(renderedTask).toContain('disabled=""');
    expect(sanitizedRawInput).not.toContain('type="text"');
    expect(sanitizedRawInput).toContain('type="checkbox"');
    expect(sanitizedRawInput).toContain('disabled=""');
  });

  it('post-processes absolute external links without granting target/rel from content', () => {
    const html = sanitizeMarkdownHtml(
      '<a href="https://example.com" target="_self" rel="opener">external</a><a href="/local">local</a>'
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).toContain('<a href="/local">local</a>');
    expect(html).not.toContain('target="_self"');
    expect(html).not.toContain('rel="opener"');
  });

  it('applies the exact URL scheme policy for links and images', () => {
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('http://example.com')).toBe(true);
    expect(isSafeHref('mailto:hello@example.com')).toBe(true);
    expect(isSafeHref('/relative/path')).toBe(true);
    expect(isSafeHref('#fragment')).toBe(true);
    expect(isSafeHref('java\nscript:alert(1)')).toBe(false);
    expect(isSafeHref('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeHref('file:///etc/passwd')).toBe(false);
    expect(isSafeHref('//example.com/protocol-relative')).toBe(false);

    expect(isSafeImageSrc('https://example.com/image.png')).toBe(true);
    expect(isSafeImageSrc('http://example.com/image.png')).toBe(true);
    expect(isSafeImageSrc('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeImageSrc('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    expect(isSafeImageSrc('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isSafeImageSrc('data:text/html;base64,PGgxPmJvb208L2gxPg==')).toBe(false);
    expect(isSafeImageSrc('/relative-image.png')).toBe(false);
  });
});
