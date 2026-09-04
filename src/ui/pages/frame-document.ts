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
 * 1. **The shell concatenates; it never parses or rewrites.** `content` is joined with fixed
 *    strings and is otherwise untouched — never parsed, never transformed, never inspected beyond
 *    the first sixty-four characters it takes to tell a document from a fragment. The frame is the
 *    product's security boundary and its sanitising posture lives upstream; this module must not
 *    become a second, weaker opinion about the same bytes.
 *
 *    That constraint used to be spelled "the shell wraps", and the difference matters: wrapping is
 *    something only a fragment can receive, so the rule quietly excluded whole documents from
 *    everything this module does — including the one thing every framed document needs.
 * 2. **It is self-contained.** The frame is served from the sandbox origin, which cannot load the
 *    app stylesheet, and its CSP is `default-src 'none'`. So: one inline `<style>`, no `<link>`,
 *    no font file, no request of any kind — and no script beyond the audited height sender
 *    below, which is added only to fragments this shell wraps.
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

/**
 * The frame-height sender.
 *
 * The viewer has always installed a listener for `aa:frame-height`, keyed on the posting frame's
 * own `contentWindow`. Nothing ever sent the message, so every HTML artifact rendered at the CSS
 * fallback height — a fixed 432px — no matter how long it was.
 *
 * Approved policy change (A-25): this shell previously added no script at all. It now adds exactly
 * this one, to wrapped fragments only. The reasoning, recorded because the invariant it replaces
 * was a deliberate one: the frame is served with `sandbox allow-scripts`, so the agent's own
 * scripts already run here. A sender that posts a number to the embedder adds no capability the
 * sandbox did not already grant. The invariant becomes "adds only the audited height sender".
 *
 * Inert by construction: it does nothing unless framed, posts one fixed-shape message, and never
 * reads the parent, touches storage, issues a request or mutates the document. `'*'` is the correct
 * target origin because the frame is on an opaque sandbox origin and the payload is a single
 * integer; the listener authenticates the sender by `contentWindow` identity, not by origin.
 */
const FRAME_HEIGHT_SENDER = [
  '(function(){',
  'if(window.parent===window)return;',
  'var last=0;',
  'function send(){',
  // ONE MEASUREMENT, AND IT IS THE ONLY ONE THAT IS RIGHT IN BOTH DIRECTIONS.
  //
  // This was `Math.min(documentElement.scrollHeight, body.bottom + body.marginBottom)`, two numbers
  // each wrong about the case the other covers. `scrollHeight` is floored at the frame's own
  // viewport, so short content could never report less than the box it was poured into — that was
  // A-25. The body's border box is not floored, but a trailing margin collapses out of it, so tall
  // content came back short: measured, a document ending in a paragraph reported 4114 for a 4130px
  // document, and those 16px went behind a scrollbar.
  //
  // The root element's border box is neither. Measured against the same two documents at five
  // viewports: tall reads 4130 everywhere, short reads 114 while `scrollHeight` reads 802 at 1440
  // and 714 at 375 and the body's box reads 98. It includes the trailing margin and it is not
  // floored, so there is nothing left to choose between and nothing to compare against the current
  // box — which matters, because the current box is this script's own last answer, and a
  // measurement that reads its own output oscillates. It did: 4130, 4114, 4130.
  'var d=document.documentElement;',
  'var h=Math.ceil(d.getBoundingClientRect().height);',
  // A document that declares `html{height:100%}` measures the viewport here and means to; the
  // fallback is only for a root box that reports nothing at all.
  'if(!(h>0))h=Math.ceil(d.scrollHeight);',
  'if(!isFinite(h)||h<=0||h===last)return;',
  'last=h;',
  "window.parent.postMessage({type:'aa:frame-height',height:h},'*');",
  '}',
  'send();',
  "window.addEventListener('load',send);",
  "if(typeof ResizeObserver==='function'){new ResizeObserver(send).observe(document.documentElement);}",
  '})();',
].join('');

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

/**
 * THE HEIGHT SENDER GOES ON EVERY FRAMED DOCUMENT, NOT ONLY THE ONES THIS SHELL BUILT.
 *
 * A full document used to be returned byte-for-byte, on the reasoning that it had already made
 * every decision this shell would make. That reasoning is right about the doctype, the charset, the
 * viewport and the stylesheet — and wrong about the height, because the height is not a decision
 * the DOCUMENT makes. It is a measurement only the document can take and only the embedder can act
 * on, and the frame is cross-origin by construction (`sandbox allow-scripts`, no
 * `allow-same-origin`), so the embedder cannot take it itself. Without a sender there is no
 * measurement, and `.aa-viewer-frame` settles at whatever the flex row leaves it.
 *
 * Measured on the shipped product, publishing each built-in HTML template through the real API and
 * opening the real share link:
 *
 *   recap              1440 → 802px frame holding 2854px · 390 → 746px holding 5271px
 *   metrics-dashboard  1440 → 802px frame holding 1329px · 390 → 746px holding 2676px
 *   report-html        1440 → 802px frame holding 3344px · 390 → 746px holding 4972px
 *
 * On a phone the recap showed 14% of itself inside a nested scrollbar, on a page that did not
 * itself scroll. All three built-ins are full documents, and so is anything an agent produces by
 * rehashing one — which is what the template flow asks it to do.
 *
 * The append is still concatenation: the string is joined to the end of the agent's bytes, and
 * nothing looks inside them. Content after `</html>` is not an error the parser rejects — the spec
 * puts the parser in "after after body" and processes a `<script>` token there with the rules for
 * "in body", so it lands in the body and runs, which is the same treatment it gets in the wrapped
 * fragment below. What this module must never do is find a place *inside* the agent's markup to put
 * something, and it still does not.
 */
export function FrameDocument({ content, title }: FrameDocumentInput): string {
  if (isFullHtmlDocument(content)) {
    return `${content}<script>${FRAME_HEIGHT_SENDER}</script>`;
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
    `<script>${FRAME_HEIGHT_SENDER}</script>`,
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
