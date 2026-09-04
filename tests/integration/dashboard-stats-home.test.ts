import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME, SessionService } from '../../src/services/sessions.js';
import { COUNTING_NOTE, READERS_DEFINITION } from '../../src/ui/copy/analytics-copy.js';
import {
  createIntegrationTestContext,
  type IntegrationTestContext,
  publishArtifact,
  TEST_NOW,
} from '../support/integration-harness.js';

const READER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

async function ownerCookie(ctx: IntegrationTestContext): Promise<string> {
  const session = await new SessionService(ctx.db, ctx.config).createSession(ctx.account.id);
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
}

async function read(ctx: IntegrationTestContext, shareId: string, ip: string): Promise<void> {
  await ctx.app.request(`/a/${shareId}`, {
    headers: { 'user-agent': READER_UA, 'x-forwarded-for': ip },
  });
  await ctx.analytics.flush();
}

/**
 * `/dashboard` answers "is anyone reading my work" now, and the list answers "what have I got" one
 * click away. The swap is the point of the phase, so the properties that make it survivable — the
 * list keeping its filters, its URLs and its nav entry — are asserted here rather than assumed.
 */
describe('the dashboard leads with readership', () => {
  it('greets the owner with the number and offers the ranges', async () => {
    const ctx = await createIntegrationTestContext({ trustProxy: 1 });

    try {
      const artifact = await publishArtifact(ctx, { slug: 'read-me', now: TEST_NOW, share: true });
      const shareId = artifact.share?.shareId as string;
      await read(ctx, shareId, '203.0.113.1');
      await read(ctx, shareId, '203.0.113.2');

      const cookie = await ownerCookie(ctx);
      const html = await (
        await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
      ).text();

      expect(html).toContain('2 readers in the last 24 hours');
      expect(html).toContain(READERS_DEFINITION);
      // Three ranges, the current one marked for anyone not reading colour.
      for (const label of ['24 hours', '7 days', '30 days']) {
        expect(html, label).toContain(label);
      }
      expect(html).toContain('href="/dashboard?range=7d"');
      expect(html).toContain('aria-current="page"');
      // A chart, server-rendered, with no script behind it.
      expect(html).toContain('aa-sparkline__line');
      expect(html).not.toMatch(/<script(?![^>]*type="application\/json")(?![^>]*\ssrc=)/i);
    } finally {
      await ctx.cleanup();
    }
  });

  it('honours the range in the URL', async () => {
    const ctx = await createIntegrationTestContext({ trustProxy: 1 });

    try {
      const cookie = await ownerCookie(ctx);
      const html = await (
        await ctx.app.request('/dashboard?range=30d', { headers: { Cookie: cookie } })
      ).text();

      expect(html).toContain('href="/dashboard?range=24h"');
      expect(html).toMatch(/href="\/dashboard\?range=30d"[^>]*aria-current="page"/);
    } finally {
      await ctx.cleanup();
    }
  });

  it('says nothing has been read yet rather than showing a chart of zeros', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      await publishArtifact(ctx, { slug: 'unread', now: TEST_NOW, share: true });
      const cookie = await ownerCookie(ctx);
      const html = await (
        await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
      ).text();

      // "Nothing yet" and "nothing lately" are different situations. A first-run account gets the
      // one that tells it what to do next.
      expect(html).toContain('nothing has been read yet');
      expect(html).toContain('No reads yet');
      expect(html).toContain('href="/dashboard/artifacts"');
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps the artifacts list one click away, with its filters and its URLs', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      const artifact = await publishArtifact(ctx, { slug: 'listed', now: TEST_NOW, share: true });
      const cookie = await ownerCookie(ctx);

      const overview = await (
        await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
      ).text();
      // The nav still leads to it, and it is still called Artifacts.
      expect(overview).toContain('href="/dashboard/artifacts"');
      expect(overview).toContain('>Artifacts<');

      const list = await ctx.app.request('/dashboard/artifacts', { headers: { Cookie: cookie } });
      expect(list.status).toBe(200);
      const listHtml = await list.text();
      expect(listHtml).toContain('Your agent&#39;s published work');
      // Its filter form posts back to its own address, not to the overview.
      expect(listHtml).toContain('action="/dashboard/artifacts"');

      // And the detail URL that people may have bookmarked is untouched.
      const detail = await ctx.app.request(`/dashboard/artifacts/${artifact.artifact.id}`, {
        headers: { Cookie: cookie },
      });
      expect(detail.status).toBe(200);
    } finally {
      await ctx.cleanup();
    }
  });

  it('carries the dated counting note on both surfaces that show a total', async () => {
    const ctx = await createIntegrationTestContext({ trustProxy: 1 });

    try {
      const artifact = await publishArtifact(ctx, { slug: 'noted', now: TEST_NOW, share: true });
      const cookie = await ownerCookie(ctx);

      const overview = await (
        await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
      ).text();
      const detail = await (
        await ctx.app.request(`/dashboard/artifacts/${artifact.artifact.id}`, {
          headers: { Cookie: cookie },
        })
      ).text();

      // Totals move across the cutover in both directions. A number that moves without explanation
      // reads as a bug, so the explanation ships in the same release as the movement.
      for (const [name, html] of [
        ['overview', overview],
        ['detail', detail],
      ] as const) {
        expect(html, name).toContain('Counting improved on 4 September 2026');
        expect(html, name).toContain(COUNTING_NOTE);
      }
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('the relabel', () => {
  it('never says "unique viewer" anywhere an owner can see', async () => {
    const ctx = await createIntegrationTestContext({ trustProxy: 1 });

    try {
      const artifact = await publishArtifact(ctx, { slug: 'labelled', now: TEST_NOW, share: true });
      const shareId = artifact.share?.shareId as string;
      await read(ctx, shareId, '203.0.113.7');
      const cookie = await ownerCookie(ctx);

      for (const path of [
        '/dashboard',
        '/dashboard/artifacts',
        `/dashboard/artifacts/${artifact.artifact.id}`,
      ]) {
        const html = await (await ctx.app.request(path, { headers: { Cookie: cookie } })).text();
        // The old label claimed a headcount over the whole range. Identity rotates daily now, so
        // that claim stopped being true the moment the cookie went away.
        expect(html, path).not.toMatch(/unique viewer/i);
      }

      const detail = await (
        await ctx.app.request(`/dashboard/artifacts/${artifact.artifact.id}`, {
          headers: { Cookie: cookie },
        })
      ).text();
      expect(detail).toContain('1 reader');
      expect(detail).toContain(READERS_DEFINITION);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('one artifact’s audience', () => {
  it('shows its own chart, referrers and devices', async () => {
    const ctx = await createIntegrationTestContext({ trustProxy: 1 });

    try {
      const artifact = await publishArtifact(ctx, { slug: 'audience', now: TEST_NOW, share: true });
      const shareId = artifact.share?.shareId as string;
      await ctx.app.request(`/a/${shareId}`, {
        headers: {
          'user-agent': READER_UA,
          'x-forwarded-for': '203.0.113.20',
          referer: 'https://news.ycombinator.com/item?id=1',
        },
      });
      await ctx.analytics.flush();

      const cookie = await ownerCookie(ctx);
      const html = await (
        await ctx.app.request(`/dashboard/artifacts/${artifact.artifact.id}`, {
          headers: { Cookie: cookie },
        })
      ).text();

      expect(html).toContain('Audience');
      expect(html).toContain('aa-sparkline__line');
      expect(html).toContain('news.ycombinator.com');
      expect(html).toContain('desktop');
      // Its own range control, scoped to this artifact.
      expect(html).toContain(`href="/dashboard/artifacts/${artifact.artifact.id}?range=7d"`);
    } finally {
      await ctx.cleanup();
    }
  });

  it('says so plainly when an artifact has not been read', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      const artifact = await publishArtifact(ctx, { slug: 'quiet', now: TEST_NOW, share: true });
      const cookie = await ownerCookie(ctx);
      const html = await (
        await ctx.app.request(`/dashboard/artifacts/${artifact.artifact.id}`, {
          headers: { Cookie: cookie },
        })
      ).text();

      expect(html).toContain('Not read yet');
    } finally {
      await ctx.cleanup();
    }
  });
});
