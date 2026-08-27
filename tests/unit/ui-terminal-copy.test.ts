import { renderToString } from 'hono/jsx/dom/server';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_TERMINAL_COPY,
  type ClientTerminalStatus,
  ShareTerminalMain,
} from '../../src/ui/components/share-terminal-main.js';

/**
 * The copy anchor, and the reason it has to exist separately from the parity test.
 *
 * `ui-terminal-parity.test.ts` compares the viewer's parked `<template>` against the `<main>` the
 * server renders — and both sides are rendered from `CLIENT_TERMINAL_COPY`. That proves the two
 * call sites agree; it cannot notice that they agree on nonsense. A junk 410 title passed the
 * entire suite. Self-referential, exactly where content matters most: these are the pages a
 * stranger sees when a link they were given has stopped working.
 *
 * So the expected strings are written out here, by hand, deliberately duplicating the source. The
 * duplication is the mechanism, not an oversight: changing user-facing copy on a terminal page
 * should require changing it twice and explaining why in a diff. If that ever feels annoying, the
 * annoyance is the feature working.
 */
const EXPECTED: Record<ClientTerminalStatus, { title: string; message: string; action: string }> = {
  404: {
    title: 'Not found',
    message: 'This artifact may have been removed, or the link may be wrong.',
    action: 'Go home',
  },
  410: {
    title: 'This link is no longer available.',
    message: 'The owner stopped sharing it, or it has expired.',
    action: 'Go home',
  },
};

const STATUSES = Object.keys(EXPECTED).map(Number) as ClientTerminalStatus[];

describe('terminal copy is anchored, not merely consistent', () => {
  it('says exactly what it is supposed to say, per status', () => {
    for (const status of STATUSES) {
      expect(CLIENT_TERMINAL_COPY[status], `status ${status}`).toEqual({
        title: EXPECTED[status].title,
        message: EXPECTED[status].message,
      });
    }
  });

  it('covers every status a client terminal can reach, and no more', () => {
    // A status added to the union without copy would render an empty card; one left here after the
    // union shrinks would rot unnoticed.
    expect(Object.keys(CLIENT_TERMINAL_COPY).map(Number).sort()).toEqual([...STATUSES].sort());
  });

  it('puts those exact words on the rendered page, with the action they belong to', () => {
    // The constant being right is not the same as the page showing it.
    for (const status of STATUSES) {
      const html = renderToString(
        ShareTerminalMain({
          title: CLIENT_TERMINAL_COPY[status].title,
          message: CLIENT_TERMINAL_COPY[status].message,
          shareUrl: '/a/AbCdEfGhIjKlMnOpQrStUv',
          status,
        })
      );

      expect(html, `status ${status} title`).toContain(EXPECTED[status].title);
      expect(html, `status ${status} message`).toContain(EXPECTED[status].message);
      expect(html, `status ${status} action`).toContain(EXPECTED[status].action);
    }
  });

  it('holds the copy to a standard, so a plausible typo is caught too', () => {
    // An exact-match anchor catches a *changed* string. These catch a *bad* one — including a bad
    // one that arrives together with a matching edit to the table above.
    for (const status of STATUSES) {
      const { title, message } = CLIENT_TERMINAL_COPY[status];

      expect(title.length, `status ${status} title is empty`).toBeGreaterThan(0);
      expect(message.length, `status ${status} message is empty`).toBeGreaterThan(0);
      expect(message, `status ${status} repeats itself`).not.toBe(title);

      // A reader is not owed the status code; they are owed a sentence.
      expect(`${title} ${message}`, `status ${status} leaks a status code`).not.toMatch(
        /\b(?:401|403|404|410|429|5\d\d)\b/
      );
      expect(message.trim(), `status ${status} message is not a sentence`).toMatch(/[.!?]$/);
      expect(`${title} ${message}`, `status ${status} reads as placeholder`).not.toMatch(
        /\b(?:TODO|TBD|FIXME|lorem|xxx|placeholder|test)\b/i
      );
    }
  });
});
