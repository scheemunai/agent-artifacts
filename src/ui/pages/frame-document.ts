/**
 * The document shell for the sandboxed artifact frame.
 *
 * `/a/:share_id/frame` used to return the agent's markup verbatim, so an HTML artifact — half of
 * what this product publishes — rendered with no doctype, no charset, no viewport and no
 * stylesheet: Times New Roman against the UA's 8px body margin, and unscalable on a phone. The
 * frame is a public, directly navigable URL, so that was a shipped surface, not an implementation
 * detail.
 *
 * Three constraints shape everything here:
 *
 * 1. **The shell wraps; it never rewrites.** `content` is concatenated, never parsed, never
 *    transformed. The frame is the product's security boundary and its sanitising posture lives
 *    upstream; this module must not become a second, weaker opinion about the same bytes.
 * 2. **It is self-contained.** The frame is served from the sandbox origin, which cannot load the
 *    app stylesheet, and its CSP is `default-src 'none'`. So: one inline `<style>`, no `<link>`,
 *    no font file, no request of any kind — and no script, ever.
 * 3. **The agent's content dominates.** Every baseline rule is a bare element selector, so any
 *    class, id or inline style the agent writes outranks it. There is no app chrome in the frame.
 *
 * These are plain string builders rather than JSX because the output is a whole document,
 * including its doctype, with agent HTML embedded raw.
 */

import { UNKNOWN_CAUSE_RECOURSE } from '../copy/terminal-copy.js';

/** Fresh Air token values, inlined because the sandbox origin cannot fetch the stylesheet. */
const INK = '#2f3a40';
const MUTED = '#5b6870';
const LINE = '#dde4e0';
const SURFACE = '#e8eeea';
const SURFACE_RAISED = '#ffffff';
const BG = '#f1f5f2';
const ACCENT = '#c2482a';

const SANS =
  '"Source Sans 3", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * Typographic ground only: enough that agent markup reads as a document instead of a 1996 default,
 * and nothing that an agent's own stylesheet cannot override.
 */
const FRAME_BASELINE_CSS = `
:root{color-scheme:light}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;padding:1.5rem;color:${INK};background:${SURFACE_RAISED};font-family:${SANS};font-size:1rem;line-height:1.6;overflow-wrap:break-word}
h1,h2,h3,h4,h5,h6{line-height:1.25;letter-spacing:-0.015em}
h1{font-size:1.875rem}
h2{font-size:1.5rem}
h3{font-size:1.25rem}
p,ul,ol,blockquote,pre,table,figure{margin-top:0}
img,svg,video,canvas{max-width:100%;height:auto}
iframe{max-width:100%}
table{max-width:100%;border-collapse:collapse}
th,td{padding:0.5rem 0.75rem;border-bottom:1px solid ${LINE};text-align:left;vertical-align:top}
code,kbd,samp,pre{font-family:${MONO};font-size:0.9375em}
pre{max-width:100%;overflow-x:auto;padding:1rem;background:${SURFACE};border-radius:0.5rem}
a{color:${ACCENT}}
hr{height:1px;border:0;background:${LINE}}
blockquote{margin-left:0;margin-right:0;padding-left:1rem;border-left:2px solid ${LINE};color:${MUTED}}
button,input,select,textarea{font-family:inherit;font-size:inherit}
@media (min-width:48rem){body{padding:2rem}}
`.trim();

const TERMINAL_CSS = `
:root{color-scheme:light}
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%}
body{display:grid;place-items:center;margin:0;padding:2rem 1.5rem;color:${INK};background:${BG};font-family:${SANS};font-size:1rem;line-height:1.6}
main{display:grid;width:min(100%,27rem);gap:1rem;justify-items:center;text-align:center}
svg{display:block;width:1.75rem;height:1.75rem;color:${ACCENT}}
h1{margin:0;font-size:1.5rem;font-weight:650;letter-spacing:-0.02em;line-height:1.25}
p{margin:0;color:${MUTED}}
a{display:inline-flex;min-height:2.75rem;align-items:center;justify-content:center;margin-top:0.5rem;padding:0 1rem;border:1px solid #cbd6d0;border-radius:0.375rem;color:${INK};background:${SURFACE_RAISED};font-size:0.875rem;font-weight:650;text-decoration:none}
`.trim();

/** The `ProductMark` vector, inline. One brand mark, including on the sandbox origin. */
const PRODUCT_MARK_SVG =
  '<svg viewBox="0 0 32 32" role="presentation" aria-hidden="true" focusable="false">' +
  '<g transform="rotate(45 16 16)">' +
  '<path fill="currentColor" fill-rule="evenodd" d="M6 6 H16 L26 16 V26 H6 Z M16 6 L26 16 H16 Z" />' +
  '</g></svg>';

export interface FrameDocumentInput {
  /** Agent HTML, exactly as stored. Never parsed, never transformed. */
  content: string;
  title: string;
}

export interface FrameTerminalDocumentInput {
  status: 401 | 404 | 410;
  /** Where the single action points — the app origin, not the sandbox origin. */
  homeUrl: string;
}

/** Module-local: nothing outside this file builds HTML as strings, and nothing should. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * True when the agent already shipped a whole document. Those pass through untouched: an artifact
 * that declares its own `<!doctype>`, `<html>` and `<head>` has made every decision this shell
 * would otherwise make, and wrapping it would produce nested documents.
 */
export function isFullHtmlDocument(content: string): boolean {
  const head = stripLeadingNoise(content).slice(0, 64).toLowerCase();
  return head.startsWith('<!doctype') || /^<html[\s>]/.test(head) || head === '<html';
}

function stripLeadingNoise(content: string): string {
  let rest = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  for (;;) {
    rest = rest.replace(/^\s+/, '');
    if (!rest.startsWith('<!--')) {
      return rest;
    }
    const end = rest.indexOf('-->');
    if (end === -1) {
      return rest;
    }
    rest = rest.slice(end + 3);
  }
}

/** Wraps an agent HTML fragment in a minimal, self-contained document. */
export function FrameDocument({ content, title }: FrameDocumentInput): string {
  if (isFullHtmlDocument(content)) {
    return content;
  }

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${FRAME_BASELINE_CSS}</style>`,
    '</head>',
    '<body>',
    content,
    '</body>',
    '</html>',
  ].join('');
}

/**
 * The sandbox origin's terminal state. Previously `Not found` in bare monospace at 8,12 on white:
  no mark, no colour, no explanation, no way onward.
 */
export function FrameTerminalDocument({ status, homeUrl }: FrameTerminalDocumentInput): string {
  const copy = terminalCopy(status);

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(copy.title)}</title>`,
    '<meta name="robots" content="noindex">',
    `<style>${TERMINAL_CSS}</style>`,
    '</head>',
    '<body>',
    '<main>',
    PRODUCT_MARK_SVG,
    `<h1>${escapeHtml(copy.title)}</h1>`,
    `<p>${escapeHtml(copy.message)}</p>`,
    `<a href="${escapeHtml(homeUrl)}">Go to Agent Artifacts</a>`,
    '</main>',
    '</body>',
    '</html>',
  ].join('');
}

function terminalCopy(status: 401 | 404 | 410): { title: string; message: string } {
  if (status === 410) {
    return {
      title: 'This artifact is no longer available.',
      // Same rule as the viewer's client swap: this document is built from a status code alone, so
      // it cannot name a cause without guessing, and one of the causes is not ours to disclose.
      message: UNKNOWN_CAUSE_RECOURSE,
    };
  }

  if (status === 401) {
    return {
      title: 'This artifact is password-protected.',
      message: 'Open the artifact page and enter its password to view it.',
    };
  }

  return {
    title: "This artifact isn't available here.",
    message: 'The link may be wrong, or the artifact may have been removed.',
  };
}
