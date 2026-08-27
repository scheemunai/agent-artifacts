import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import { TERMINAL_CAUSE_COPY, type TerminalCause } from '../../src/ui/copy/terminal-copy.js';
import { ViewerPage } from '../../src/ui/pages/viewer.js';
import { readClientSource } from '../support/client-assets.js';

/**
 * N-2. The 410 envelope names its cause — `share_revoked`, `share_expired`, `share_disabled`,
 * `artifact_expired` — and has since the API was written. The client ignored the body and rendered
 * one status-level sentence for all four, because a comment in the copy module asserted that a poll
 * "only ever learns a status code". The comment was wrong, and being wrong in a comment is how it
 * survived: nobody re-checks a documented impossibility.
 *
 * So the same reader, at the same moment, got a worse answer from the live page than from a reload.
 */
const viewerScript = readClientSource('viewer.js');
const html = renderToString(
  ViewerPage({
    model: {
      shareId: 'AbCdEfGhIjKlMnOpQrStUv',
      canonicalUrl: 'https://example.test/a/AbCdEfGhIjKlMnOpQrStUv',
      passwordProtected: false,
      footer: true,
      meta: {
        title: 'Weekly Ops',
        description: 'd',
        imageUrl: 'https://example.test/og.png',
        canonicalUrl: 'https://example.test/a/AbCdEfGhIjKlMnOpQrStUv',
        protected: false,
      },
    } as never,
    abuseEmail: 'abuse@example.test',
  })
);

const CAUSES = Object.keys(TERMINAL_CAUSE_COPY) as TerminalCause[];

describe('mid-view terminal states name the cause the server named', () => {
  it('parks a template for every cause the envelope can carry', () => {
    expect(CAUSES.length).toBeGreaterThan(3);

    for (const cause of CAUSES) {
      expect(html, `no template for ${cause}`).toContain(`data-aa-terminal-template="${cause}"`);
      expect(html, `${cause} template renders no copy`).toContain(TERMINAL_CAUSE_COPY[cause].title);
    }
  });

  it('selects by cause and still falls back to the bare status', () => {
    expect(viewerScript).toContain('terminalCause');
    expect(viewerScript).toContain('body.error.code');
    // Both lookups present: a cause that has no template, or a body that will not parse, must still
    // produce a page rather than nothing.
    expect(viewerScript).toMatch(/data-aa-terminal-template="\$\{cause\}"/);
    expect(viewerScript).toMatch(/data-aa-terminal-template="\$\{status\}"/);
  });

  it('keeps a disabled share what-not-why, even though the cause is now known', () => {
    // The ruling: selecting copy by cause is not disclosing the cause. A share disabled by
    // moderation must not blame the owner or reveal their account state.
    const disabled = TERMINAL_CAUSE_COPY.share_disabled;
    const text = `${disabled.title} ${disabled.message}`;

    expect(text).not.toMatch(/\bowner\b|\bsuspend|\brevoked\b|\bmoderat/i);
    expect(text, 'the reader is left with no recourse').toMatch(/ask whoever shared it/i);
  });

  it('states each cause differently from the others', () => {
    // The defect was four causes reading identically. Distinctness is the property that failed.
    const messages = CAUSES.map((cause) => TERMINAL_CAUSE_COPY[cause].message);
    expect(new Set(messages).size, `duplicate cause copy: ${messages.join(' | ')}`).toBe(
      messages.length
    );
  });
});
