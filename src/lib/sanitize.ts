import DOMPurify, { type Config } from 'isomorphic-dompurify';

export const MARKDOWN_ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'del',
  's',
  'mark',
  'sup',
  'sub',
  'kbd',
  'abbr',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'a',
  'img',
  'details',
  'summary',
  'figure',
  'figcaption',
  'span',
  'div',
  'input',
] as const;

const GLOBAL_ATTRIBUTES = new Set(['id', 'class', 'lang', 'dir', 'title']);
const TAG_ATTRIBUTES = new Map<string, ReadonlySet<string>>([
  ['a', new Set(['href'])],
  ['img', new Set(['src', 'alt', 'width', 'height', 'loading'])],
  ['th', new Set(['colspan', 'rowspan', 'align'])],
  ['td', new Set(['colspan', 'rowspan', 'align'])],
  ['ol', new Set(['start', 'type'])],
  ['input', new Set(['type', 'checked', 'disabled'])],
]);

export const MARKDOWN_ALLOWED_ATTRIBUTES = [
  'id',
  'class',
  'lang',
  'dir',
  'title',
  'href',
  'src',
  'alt',
  'width',
  'height',
  'loading',
  'colspan',
  'rowspan',
  'align',
  'start',
  'type',
  'checked',
  'disabled',
] as const;

const FORBIDDEN_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'link',
  'meta',
  'base',
  'svg',
  'math',
] as const;

const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow ugc';
const DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const RESERVED_VIEWER_CLASS_PATTERN = /^aa-/i;
const URI_SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):/i;

export const MARKDOWN_SANITIZE_CONFIG: Config = {
  ALLOWED_TAGS: [...MARKDOWN_ALLOWED_TAGS],
  ALLOWED_ATTR: [...MARKDOWN_ALLOWED_ATTRIBUTES],
  ALLOWED_NAMESPACES: ['http://www.w3.org/1999/xhtml'],
  ALLOW_ARIA_ATTR: false,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_TAGS: [...FORBIDDEN_TAGS],
  FORBID_ATTR: ['style'],
  FORBID_CONTENTS: [...FORBIDDEN_TAGS],
  SAFE_FOR_XML: true,
  SANITIZE_DOM: true,
  SANITIZE_NAMED_PROPS: true,
};

installMarkdownSanitizerHooks();

/**
 * The sanitizer's own DOM, so a caller that has to *decorate* the result does not have to re-parse
 * it — and, more to the point, does not get to hold a second opinion about what the markup is.
 *
 * `renderMarkdown()` needs to add two things the stylesheet has always expected and never
 * received: the scroll region around a table, and the class on a task-list item. Both are
 * structural, both have to survive nesting, and both were reachable only by pattern-matching the
 * serialized string — which is exactly the kind of second, weaker parser this module exists to
 * avoid. Handing back the tree the sanitizer already built costs nothing and removes the
 * temptation.
 *
 * What comes back is DOMPurify's `<body>`. Anything added to it afterwards is OURS, added after
 * every hook has run, and is therefore not author input: that is the whole reason the wrapper can
 * carry an `aa-` class and a `data-` attribute when author markup cannot.
 */
export function sanitizeMarkdownToBody(dirtyHtml: string): Element {
  return DOMPurify.sanitize(dirtyHtml, {
    ...MARKDOWN_SANITIZE_CONFIG,
    RETURN_DOM: true,
  }) as unknown as Element;
}

export function sanitizeMarkdownHtml(dirtyHtml: string): string {
  return sanitizeMarkdownToBody(dirtyHtml).innerHTML;
}

export function isSafeHref(value: string): boolean {
  const normalized = normalizeUrlForSchemeCheck(value);
  if (normalized === '') {
    return true;
  }

  if (normalized.startsWith('#')) {
    return true;
  }

  if (normalized.startsWith('//')) {
    return false;
  }

  const scheme = URI_SCHEME_PATTERN.exec(normalized)?.[1]?.toLowerCase();
  if (scheme) {
    return ['http', 'https', 'mailto'].includes(scheme);
  }

  return true;
}

export function isSafeImageSrc(value: string): boolean {
  const normalized = normalizeUrlForSchemeCheck(value);
  if (normalized === '' || normalized.startsWith('//')) {
    return false;
  }

  if (DATA_IMAGE_PATTERN.test(normalized)) {
    return true;
  }

  const scheme = URI_SCHEME_PATTERN.exec(normalized)?.[1]?.toLowerCase();
  return scheme === 'http' || scheme === 'https';
}

function installMarkdownSanitizerHooks(): void {
  const hookState = globalThis as typeof globalThis & {
    __agentArtifactsMarkdownSanitizerHooksInstalled?: boolean;
  };

  if (hookState.__agentArtifactsMarkdownSanitizerHooksInstalled) {
    return;
  }

  DOMPurify.addHook('afterSanitizeAttributes', (currentNode) => {
    if (!isElementNode(currentNode)) {
      return;
    }

    const tagName = currentNode.tagName.toLowerCase();

    for (const attribute of Array.from(currentNode.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      if (!isAllowedAttribute(tagName, attributeName) || attributeName.startsWith('on')) {
        currentNode.removeAttribute(attribute.name);
      }
    }

    sanitizeClassList(currentNode);
    sanitizeUrls(currentNode, tagName);
    enforceCheckboxOnlyInput(currentNode, tagName);
    postProcessExternalLinks(currentNode, tagName);
  });

  hookState.__agentArtifactsMarkdownSanitizerHooksInstalled = true;
}

function isElementNode(node: Node): node is Element {
  return node.nodeType === 1 && 'attributes' in node && 'tagName' in node;
}

function isAllowedAttribute(tagName: string, attributeName: string): boolean {
  if (GLOBAL_ATTRIBUTES.has(attributeName)) {
    return true;
  }

  return TAG_ATTRIBUTES.get(tagName)?.has(attributeName) ?? false;
}

function sanitizeClassList(currentNode: Element): void {
  const className = currentNode.getAttribute('class');
  if (!className) {
    return;
  }

  const safeClasses = className
    .split(/\s+/)
    .filter((token) => token.length > 0 && !RESERVED_VIEWER_CLASS_PATTERN.test(token));

  if (safeClasses.length === 0) {
    currentNode.removeAttribute('class');
    return;
  }

  currentNode.setAttribute('class', safeClasses.join(' '));
}

function sanitizeUrls(currentNode: Element, tagName: string): void {
  const href = currentNode.getAttribute('href');
  if (href !== null && (tagName !== 'a' || !isSafeHref(href))) {
    currentNode.removeAttribute('href');
  }

  const src = currentNode.getAttribute('src');
  if (src !== null && (tagName !== 'img' || !isSafeImageSrc(src))) {
    currentNode.removeAttribute('src');
  }
}

function enforceCheckboxOnlyInput(currentNode: Element, tagName: string): void {
  if (tagName !== 'input') {
    return;
  }

  if (currentNode.getAttribute('type')?.toLowerCase() !== 'checkbox') {
    currentNode.remove();
    return;
  }

  currentNode.setAttribute('type', 'checkbox');
  currentNode.setAttribute('disabled', '');
}

function postProcessExternalLinks(currentNode: Element, tagName: string): void {
  if (tagName !== 'a') {
    return;
  }

  const href = currentNode.getAttribute('href');
  if (!href || !isExternalHttpUrl(href)) {
    return;
  }

  currentNode.setAttribute('target', '_blank');
  currentNode.setAttribute('rel', EXTERNAL_LINK_REL);
}

function isExternalHttpUrl(value: string): boolean {
  const scheme = URI_SCHEME_PATTERN.exec(normalizeUrlForSchemeCheck(value))?.[1]?.toLowerCase();
  return scheme === 'http' || scheme === 'https';
}

function normalizeUrlForSchemeCheck(value: string): string {
  return Array.from(value.trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 0x20 && codePoint !== 0x7f;
    })
    .join('');
}
