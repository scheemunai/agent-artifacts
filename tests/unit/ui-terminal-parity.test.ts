import { readFileSync } from 'node:fs';
import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import type { ViewerContentResult, ViewerPageModel } from '../../src/services/viewer.js';
import {
  CLIENT_TERMINAL_COPY,
  type ClientTerminalStatus,
  ShareTerminalPage,
} from '../../src/ui/pages/share-terminal.js';
import { VIEWER_SCRIPT_SRC, ViewerPage } from '../../src/ui/pages/viewer.js';

/**
 * When a poll discovers the share has gone, the client used to *decorate* the live page: it set the
 * chrome title to the failure message, hid the byline, and injected a terminal card into the
 * content region. Four failures came out of that one decision, measured at both viewports:
 *
 *  1. Three live controls on a dead page — the version select re-fetched the 410, Download
 *     navigated to it, and the refresh button re-confirmed it (C14).
 *  2. The failure message rendered twice, 440px apart at 1440 and 457px at 375: once as the chrome
 *     title, once as the card's h1.
 *  3. The footer pushed entirely below the fold. `.aa-viewer-terminal` keeps
 *     `min-height: calc(100vh - 4rem)`, sized for a page where it is the only content — but it now
 *     sat below 76px (1440) / 123px (375) of chrome, so the page ran to 912px against a 900px
 *     viewport. "Report abuse", the only abuse affordance on a public page, disappeared at exactly
 *     the moment the page had failed.
 *  4. A ◆ text glyph where the server draws the ProductMark SVG.
 *
 * The general rule underneath (A-49): **a screen's header is part of its state, not a constant.**
 * When a surface enters a terminal state, everything asserting the prior state goes with it. So the
 * client replaces the whole viewer root with the markup the server would have sent, and the proof
 * below is a byte comparison rather than a description.
 */
const viewerScript = readFileSync(`public${VIEWER_SCRIPT_SRC}`, 'utf8');

const content: ViewerContentResult = {
  shareId: 'AbCdEfGhIjKlMnOpQrStUv',
  accountId: 'acc_terminal_parity',
  artifactId: 'art_terminal',
  slug: 'weekly-ops',
  type: 'markdown',
  title: 'Weekly Ops Report',
  content: '# Weekly Ops',
  contentHash: 'hash-terminal',
  versionNum: 2,
  latestVersionNum: 2,
  updatedAt: 1_787_700_000_000,
  bot: { name: 'R2', byline: 'Chief of Staff' },
  passwordProtected: false,
  footer: true,
  html: '<article class="aa-md"><h1>Weekly Ops</h1></article>',
  frameUrl: null,
};

const canonicalUrl = `https://example.test/a/${content.shareId}`;

const model: ViewerPageModel = {
  shareId: content.shareId,
  canonicalUrl,
  passwordProtected: false,
  footer: true,
  meta: {
    title: content.title,
    description: 'Published with Agent Artifacts',
    imageUrl: `${canonicalUrl}/og.png`,
    canonicalUrl,
    protected: false,
  },
  initialContent: content,
};

const viewerHtml = renderToString(ViewerPage({ model, abuseEmail: 'abuse@example.test' }));

function terminalTemplate(status: ClientTerminalStatus): string {
  const match = new RegExp(
    `<template data-aa-terminal-template="${status}"[^>]*>([\\s\\S]*?)</template>`
  ).exec(viewerHtml);
  if (!match?.[1]) {
    throw new Error(`no terminal template for status ${status}`);
  }
  return match[1];
}

function serverTerminalMain(status: ClientTerminalStatus): string {
  const copy = CLIENT_TERMINAL_COPY[status];
  const page = renderToString(
    ShareTerminalPage({
      title: copy.title,
      message: copy.message,
      status,
      shareUrl: canonicalUrl,
      abuseEmail: 'abuse@example.test',
    })
  );
  const main = /<main[\s\S]*?<\/main>/.exec(page)?.[0];
  if (!main) {
    throw new Error('ShareTerminalPage rendered no <main>');
  }
  return main;
}

const STATUSES: ClientTerminalStatus[] = [404, 410];

describe('client-side terminal parity', () => {
  it('ships the server terminal markup, byte for byte, for every status a poll can hit', () => {
    for (const status of STATUSES) {
      expect(terminalTemplate(status), `status ${status}`).toBe(serverTerminalMain(status));
    }
  });

  it('replaces the viewer root rather than decorating it', () => {
    expect(viewerScript).toContain('data-aa-terminal-template');
    expect(viewerScript).toMatch(/replaceWith/);

    // The old shape, in one line each: writing the failure into the chrome title, and building the
    // card as a string in the client.
    expect(viewerScript).not.toMatch(/titleNode\.textContent\s*=\s*message/);
    expect(viewerScript).not.toContain('aa-viewer-terminal-card"');
  });

  it('takes every control asserting the previous state down with the page', () => {
    for (const status of STATUSES) {
      const markup = terminalTemplate(status);

      for (const survivor of [
        'data-aa-refresh',
        'data-aa-download',
        'data-aa-version-picker',
        'data-aa-version-banner',
        'data-aa-chrome',
        'aa-viewer-title',
        'data-aa-updated-pill',
      ]) {
        expect(markup, `${survivor} survives into the ${status} terminal`).not.toContain(survivor);
      }
    }
  });

  it('states the failure exactly once', () => {
    for (const status of STATUSES) {
      const markup = terminalTemplate(status);
      const title = CLIENT_TERMINAL_COPY[status].title;
      expect(markup.split(title).length - 1, `"${title}" appears more than once`).toBe(1);
    }
  });

  it('leaves the footer outside the terminal, where the server puts it', () => {
    // `.aa-viewer-terminal` is `min-height: calc(100vh - 4rem)`, which only fits the viewport when
    // nothing sits above it. Replacing the root — rather than injecting below the chrome — is what
    // keeps "Report abuse" on screen.
    for (const status of STATUSES) {
      expect(terminalTemplate(status)).not.toContain('aa-viewer-footer');
    }
    expect(viewerHtml.indexOf('</main>')).toBeLessThan(viewerHtml.indexOf('<footer'));
  });

  it('renders no duplicate id, templates included', () => {
    // Bounded extension of the duplicate-id sweep: this page parks two inert terminal states plus
    // the live document, so it is the one composed page where the same component appears more than
    // once. Template content is included deliberately — a clone of it lands in the real document.
    const ids = Array.from(viewerHtml.matchAll(/\sid="([^"]+)"/g), (match) => String(match[1]));
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

    expect(duplicates, `duplicate ids: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('draws the product mark, not a text glyph', () => {
    for (const status of STATUSES) {
      expect(terminalTemplate(status)).toContain('M6 6 H16 L26 16 V26 H6 Z');
    }
  });

  it('never says the same thing in the title and the body', () => {
    // The server 404 passes "Not found" as both the heading and the message; this copy must not
    // reproduce that, and the parity test above would happily propagate it if it did.
    for (const status of STATUSES) {
      const copy = CLIENT_TERMINAL_COPY[status];
      expect(copy.message, `status ${status}`).not.toBe(copy.title);
      expect(copy.message.length).toBeGreaterThan(0);
    }
  });
});
