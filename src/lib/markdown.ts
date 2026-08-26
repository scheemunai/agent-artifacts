import { createHash } from 'node:crypto';
import { marked, type Token, type TokensList } from 'marked';
import { createRenderCache, type LruCacheStats } from './render-cache.js';
import { sanitizeMarkdownHtml } from './sanitize.js';

export const MAX_MARKDOWN_BLOCK_NESTING = 32;
export const MARKDOWN_ARTICLE_CLASS = 'aa-md';

export interface RenderMarkdownOptions {
  contentHash?: string;
}

export const markdownRenderCache = createRenderCache<string>();

const MARKED_OPTIONS = {
  gfm: true,
  breaks: false,
  async: false,
} as const;

export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  const cacheKey = options.contentHash ?? hashMarkdownSource(markdown);
  return markdownRenderCache.getOrSet(cacheKey, () => renderMarkdownUncached(markdown));
}

export function renderMarkdownUncached(markdown: string): string {
  const tokens = marked.lexer(markdown, MARKED_OPTIONS);
  capBlockNesting(tokens);
  const dirtyHtml = marked.parser(tokens, MARKED_OPTIONS);
  const sanitizedHtml = sanitizeMarkdownHtml(dirtyHtml);
  return `<article class="${MARKDOWN_ARTICLE_CLASS}">${sanitizedHtml}</article>`;
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

function capBlockNesting(tokens: TokensList | Token[]): void {
  capTokenArray(tokens, 0);
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
