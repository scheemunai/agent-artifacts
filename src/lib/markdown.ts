import { createHash } from 'node:crypto';
import { marked, type Token, type TokensList } from 'marked';
import { createRenderCache, type LruCacheStats } from './render-cache.js';
import { sanitizeMarkdownToBody } from './sanitize.js';

export const MAX_MARKDOWN_BLOCK_NESTING = 32;
export const MARKDOWN_ARTICLE_CLASS = 'aa-md';

/** Shared with `Table`'s caption-less fallback so one question has one answer. */
export const TABLE_REGION_LABEL = 'Table';
export const TABLE_SCROLL_HINT = 'Scroll the table sideways to see every column.';

export interface RenderMarkdownOptions {
  contentHash?: string;
  headingOffset?: number;
}

export const markdownRenderCache = createRenderCache<string>();

const MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
  async: false,
} as const;

export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  const headingOffset = normalizeHeadingOffset(options.headingOffset);
  const cacheKey = markdownCacheKey(
    options.contentHash ?? hashMarkdownSource(markdown),
    headingOffset
  );
  return markdownRenderCache.getOrSet(cacheKey, () =>
    renderMarkdownUncached(markdown, { headingOffset })
  );
}

export function renderMarkdownUncached(
  markdown: string,
  options: Pick<RenderMarkdownOptions, 'headingOffset'> = {}
): string {
  const headingOffset = normalizeHeadingOffset(options.headingOffset);
  const tokens = marked.lexer(markdown, MARKED_OPTIONS);
  capBlockNesting(tokens);
  if (headingOffset > 0) {
    offsetHeadings(tokens, headingOffset);
  }
  const dirtyHtml = marked.parser(tokens, MARKED_OPTIONS);
  const body = sanitizeMarkdownToBody(dirtyHtml);
  markTaskListItems(body);
  wrapTablesInScrollRegions(body, hashMarkdownSource(markdown).slice(0, 12));
  return `<article class="${MARKDOWN_ARTICLE_CLASS}">${body.innerHTML}</article>`;
}

/**
 * The class `.aa-md .task-list-item` has been styling for as long as the rule has existed, and
 * nothing ever emitted it.
 *
 * `marked` renders a GFM task item as `<li><input type="checkbox" disabled> text</li>` — no class,
 * at any version this project has shipped — so the only markup in the product wearing that class
 * was the style guide's hand-written specimen, which is to say the guide was describing output
 * nobody produced. It stayed invisible because the rule it powers is `list-style: none`, and the
 * preflight was already suppressing every marker: two defects cancelling, so neither showed.
 *
 * Restoring bullets uncovers it immediately — a disc beside every checkbox — so the class is
 * emitted here rather than the rule being rewritten around what `marked` happens to produce.
 */
function markTaskListItems(body: Element): void {
  for (const checkbox of Array.from(body.querySelectorAll('li > input[type="checkbox"]'))) {
    checkbox.parentElement?.classList.add('task-list-item');
  }
}

/**
 * Wraps every rendered table in the scroll region the stylesheet has always defined for it.
 *
 * Applied to the sanitized tree rather than to the serialized string, which is what makes the
 * nesting rule expressible at all: a table inside another table's cell is already inside a scroll
 * container, and wrapping it again would nest two scroll boxes with the inner one unreachable on a
 * phone. A regex over the output cannot tell those apart.
 *
 * The markup is the affordance contract every other scrollable surface in the product carries —
 * focusable, named, measured, and described by the hint it reveals. Emitting three of the four
 * would be worse than emitting none: a tab stop that announces nothing is the specific defect
 * `Table` was fixed for.
 *
 * Ids are derived from the content hash, not from a counter, because two different artifacts are
 * rendered onto one dashboard page and a per-render counter would give both their table `#…-0`.
 */
function wrapTablesInScrollRegions(body: Element, seed: string): void {
  const document = body.ownerDocument;
  if (!document) {
    return;
  }

  let index = 0;
  for (const table of Array.from(body.querySelectorAll('table'))) {
    // The outermost table owns the scrolling for everything inside it.
    if (table.parentElement?.closest('table')) {
      continue;
    }
    const parent = table.parentNode;
    if (!parent) {
      continue;
    }

    const hintId = `aa-md-table-${seed}-${index}-hint`;
    index += 1;

    const wrap = document.createElement('div');
    wrap.setAttribute('class', 'aa-table-wrap');

    const region = document.createElement('section');
    region.setAttribute('class', 'aa-md-table-scroll');
    region.setAttribute('tabindex', '0');
    // A rendered markdown table has no caption to borrow, so it takes the same fallback name
    // `Table` gives a caption-less one rather than inventing a second answer to one question.
    region.setAttribute('aria-label', TABLE_REGION_LABEL);
    region.setAttribute('aria-describedby', hintId);
    region.setAttribute('data-aa-scroll-region', 'true');
    region.setAttribute('data-aa-scroll-hint-for', hintId);

    const hint = document.createElement('p');
    hint.setAttribute('class', 'aa-table__hint');
    hint.setAttribute('id', hintId);
    hint.setAttribute('data-aa-scroll-hint', 'true');
    // The server cannot know whether this table overflows; that depends on the viewport. Revealed
    // by the measurement in `ui-foundation`, never asserted here.
    hint.setAttribute('hidden', '');
    hint.textContent = TABLE_SCROLL_HINT;

    parent.insertBefore(wrap, table);
    region.append(table);
    wrap.append(region, hint);
  }
}

export function clearMarkdownRenderCache(): void {
  markdownRenderCache.clear();
}

export function getMarkdownRenderCacheStats(): LruCacheStats {
  return markdownRenderCache.stats();
}

export function hashMarkdownSource(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

function markdownCacheKey(contentKey: string, headingOffset: number): string {
  return `markdown:${contentKey}:heading-offset:${headingOffset}`;
}

function normalizeHeadingOffset(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(5, Math.trunc(value)));
}

function capBlockNesting(tokens: TokensList | Token[]): void {
  capTokenArray(tokens, 0);
}

function offsetHeadings(tokens: TokensList | Token[], headingOffset: number): void {
  for (const token of tokens) {
    if (token.type === 'heading') {
      token.depth = Math.min(6, token.depth + headingOffset) as typeof token.depth;
    }
    for (const childTokens of getTokenChildren(token)) {
      offsetHeadings(childTokens, headingOffset);
    }
  }
}

function capTokenArray(tokens: Token[], depth: number): void {
  for (const token of tokens) {
    capToken(token, depth);
  }
}

function capToken(token: Token, depth: number): void {
  const nextDepth = isBlockContainer(token) ? depth + 1 : depth;

  if (nextDepth >= MAX_MARKDOWN_BLOCK_NESTING) {
    pruneNestedTokens(token);
    return;
  }

  for (const childTokens of getTokenChildren(token)) {
    capTokenArray(childTokens, nextDepth);
  }
}

function isBlockContainer(token: Token): boolean {
  return token.type === 'blockquote' || token.type === 'list' || token.type === 'list_item';
}

function pruneNestedTokens(token: Token): void {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    token.tokens = [];
  }

  if (token.type === 'list') {
    token.items = [];
  }
}

function getTokenChildren(token: Token): Token[][] {
  const children: Token[][] = [];

  if ('tokens' in token && Array.isArray(token.tokens)) {
    children.push(token.tokens);
  }

  if (token.type === 'list') {
    for (const item of token.items) {
      children.push(item.tokens);
    }
  }

  if (token.type === 'table') {
    for (const cell of token.header) {
      children.push(cell.tokens);
    }
    for (const row of token.rows) {
      for (const cell of row) {
        children.push(cell.tokens);
      }
    }
  }

  return children;
}
