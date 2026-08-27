import { describe, expect, it } from 'vitest';
import { CLIENT_TERMINAL_COPY } from '../../../src/ui/pages/share-terminal.js';
import { createViewerTestContext } from './viewer-test-utils.js';

/**
 * A-10: the 404 page said "Not found" twice.
 *
 * The heading and the body carried the identical string, so the sentence under the title added
 * nothing — the reader learned the same fact twice and got no idea what to do next. Every other
 * terminal state on this surface follows the per-cause pattern: say what happened, then say
 * something the heading did not.
 *
 * The sentence it needs already existed one module away, in the copy the *client* renders when a
 * poll discovers a 404 mid-read. Same product, same moment, two different answers — so the server
 * now renders that one. This suite pins both halves: the body must add something, and the two
 * surfaces must keep agreeing.
 */
describe('the 404 terminal page', () => {
  it('does not tell the reader the same thing twice', async () => {
    const ctx = await createViewerTestContext({});
    try {
      const response = await ctx.app.request('https://agentartifact.example.test/a/no-such-share');
      expect(response.status).toBe(404);

      const html = await response.text();
      const heading = /<h1[^>]*>([^<]+)<\/h1>/.exec(html)?.[1]?.trim();
      expect(heading, 'the terminal page must have a heading').toBeDefined();

      // The body sentence has to carry information the heading does not.
      expect(html).toContain(CLIENT_TERMINAL_COPY[404].message);
      expect(CLIENT_TERMINAL_COPY[404].message).not.toBe(heading);

      // The exact failure the validator photographed: the heading's own words, repeated as the body.
      const bodyRepeatsHeading = new RegExp(`<p[^>]*>\\s*${heading}\\s*<`).test(html);
      expect(bodyRepeatsHeading, 'the body must not simply repeat the heading').toBe(false);
    } finally {
      await ctx.cleanup();
    }
  });

  it('says the same thing whether the reader arrives at a 404 or discovers one mid-read', async () => {
    const ctx = await createViewerTestContext({});
    try {
      const response = await ctx.app.request('https://agentartifact.example.test/a/no-such-share');
      const html = await response.text();

      // One string, one place: the server page and the client's mid-read swap render the same
      // sentence, which is the rule the 410 copy already follows.
      expect(html).toContain(CLIENT_TERMINAL_COPY[404].title);
      expect(html).toContain(CLIENT_TERMINAL_COPY[404].message);
    } finally {
      await ctx.cleanup();
    }
  });
});
