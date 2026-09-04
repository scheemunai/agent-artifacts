import { describe, expect, it } from 'vitest';
import {
  createViewerTestContext,
  publishSharedArtifact,
  READER_UA,
  readPage,
  shareCounters,
  updateArtifact,
  viewEvents,
} from './viewer-test-utils.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * WHAT COUNTS, AND WHO.
 *
 * The bug this replaces was not subtle once measured: the only place a view was ever recorded was
 * `/a/:id/content`, which nothing but our own boot script requests. A reader who blocks JavaScript
 * read the entire artifact — the page ships it inline — and registered nothing, while every crawler
 * that fetched that endpoint registered a fresh unique viewer, because uniqueness keyed on a cookie
 * no crawler stores. The product undercounted humans and overcounted bots, from one root cause.
 */
describe('a read is recorded where the reading happens', () => {
  it('counts a reader who never runs a line of our JavaScript', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'js-off',
        title: 'JS Off',
        content: '# JS Off\n\nRead without scripts',
      });
      const shareId = created.share?.shareId as string;

      // Exactly what a browser with scripting disabled sends: one GET, no boot, no beacon.
      const page = await readPage(ctx, shareId);
      expect(page.status).toBe(200);
      await expect(page.text()).resolves.toContain('Read without scripts');

      expect(shareCounters(ctx, shareId)).toMatchObject({
        view_count: 1,
        unique_viewer_count: 1,
      });
      const events = viewEvents(ctx, shareId);
      expect(events).toHaveLength(1);
      // Unconfirmed, and counted regardless. `js_confirmed` is a quality signal; it is not a vote
      // on whether the read happened.
      expect(events[0]?.js_confirmed).toBe(0);
      expect(events[0]?.device).toBe('desktop');
    } finally {
      await ctx.cleanup();
    }
  });

  it('never hands the reader an identifier', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'no-cookie',
        title: 'No Cookie',
        content: '# No Cookie',
      });
      const shareId = created.share?.shareId as string;

      for (const path of ['', '/content', '/download', '/og.png']) {
        const response = await ctx.app.request(`/a/${shareId}${path}`, {
          headers: { 'user-agent': READER_UA },
        });
        expect(response.headers.get('set-cookie'), path).toBeNull();
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('expires the retired aa_viewer cookie on sight', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'retire-cookie',
        title: 'Retire Cookie',
        content: '# Retire Cookie',
      });
      const shareId = created.share?.shareId as string;

      // Somebody who read a share before the cutover still carries a year-long identifier. Merely
      // not setting it again would leave the "cookieless" claim false for that whole year.
      const response = await ctx.app.request(`/a/${shareId}`, {
        headers: {
          'user-agent': READER_UA,
          Cookie: 'aa_viewer=00000000-0000-4000-8000-000000000001',
        },
      });
      const setCookie = response.headers.get('set-cookie') ?? '';
      expect(setCookie).toContain('aa_viewer=');
      expect(setCookie).toContain('Max-Age=0');
    } finally {
      await ctx.cleanup();
    }
  });

  it('excludes the owner, who is not an audience', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'owner-view',
        title: 'Owner View',
        content: '# Owner View',
      });
      const shareId = created.share?.shareId as string;

      const { cookie } = await ownerSession(ctx);
      const asOwner = await ctx.app.request(`/a/${shareId}`, {
        headers: { 'user-agent': READER_UA, 'x-forwarded-for': '198.51.100.1', Cookie: cookie },
      });
      expect(asOwner.status).toBe(200);
      await ctx.analytics.flush();
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 0 });

      // The same page, same everything, without the session: a stranger.
      await readPage(ctx, shareId, { ip: '198.51.100.2' });
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 1 });
    } finally {
      await ctx.cleanup();
    }
  });

  it('counts a pinned-version read, and records which version was read', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'pinned',
        title: 'Pinned v1',
        content: '# Pinned\n\nOne',
      });
      const shareId = created.share?.shareId as string;
      await updateArtifact(ctx, {
        slug: 'pinned',
        title: 'Pinned v2',
        content: '# Pinned\n\nTwo',
        bot: created.bot,
      });

      // A stranger asking for `?v=1` is served the latest anyway — the version gate is not ours to
      // relitigate here. What matters is that the read counts and says which version it was.
      await readPage(ctx, shareId, { query: '?v=1' });

      const events = viewEvents(ctx, shareId);
      expect(events).toHaveLength(1);
      expect(events[0]?.version_num).toBe(2);
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 1 });
    } finally {
      await ctx.cleanup();
    }
  });

  it('records a password-protected read on unlock, not on the gate', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'guarded',
        title: 'Guarded',
        content: '# Guarded\n\nSecret',
        password: 'correct horse battery',
      });
      const shareId = created.share?.shareId as string;

      // The gate is not the artifact. Somebody who bounces off it has read nothing.
      const gate = await readPage(ctx, shareId);
      expect(gate.status).toBe(200);
      await expect(gate.text()).resolves.not.toContain('Secret');
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 0 });

      const unlocked = await ctx.app.request(`/a/${shareId}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'user-agent': READER_UA },
        body: JSON.stringify({ password: 'correct horse battery' }),
      });
      expect(unlocked.status).toBe(200);
      const token = (await unlocked.json()) as { viewer_token: string };

      const content = await ctx.app.request(`/a/${shareId}/content`, {
        headers: { 'user-agent': READER_UA, 'X-AA-Share-Token': token.viewer_token },
      });
      expect(content.status).toBe(200);
      await ctx.analytics.flush();
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 1 });
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('who the reader is, without knowing who they are', () => {
  it('separates readers, joins their repeats, and forgets them across the day boundary', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'identity',
        title: 'Identity',
        content: '# Identity',
      });
      const shareId = created.share?.shareId as string;

      await readPage(ctx, shareId, { ip: '203.0.113.1' });
      await readPage(ctx, shareId, { ip: '203.0.113.2' });
      expect(shareCounters(ctx, shareId)).toMatchObject({
        view_count: 2,
        unique_viewer_count: 2,
      });

      const [first, second] = viewEvents(ctx, shareId);
      expect(first?.visitor_hash).not.toBe(second?.visitor_hash);
      // 16 bytes of digest and nothing else — no address, no user agent, nothing reversible.
      expect(first?.visitor_hash).toMatch(/^[0-9a-f]{32}$/);
      const stored = ctx.db.sqlite.prepare('SELECT * FROM view_events LIMIT 1').get() as Record<
        string,
        unknown
      >;
      for (const value of Object.values(stored)) {
        expect(String(value)).not.toContain('203.0.113');
        expect(String(value)).not.toContain('Mozilla');
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('counts one reader once when they refresh, and again once they come back', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'refresher',
        title: 'Refresher',
        content: '# Refresher',
      });
      const shareId = created.share?.shareId as string;

      for (let refresh = 0; refresh < 4; refresh += 1) {
        await readPage(ctx, shareId, { ip: '203.0.113.9' });
      }
      // Four page loads seconds apart are one read. This is the property the old cookie throttle
      // gave us, kept on identity that a crawler cannot decline to carry.
      expect(shareCounters(ctx, shareId)).toMatchObject({
        view_count: 1,
        unique_viewer_count: 1,
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('counts a returning reader as another view but the same visitor', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'returner',
        title: 'Returner',
        content: '# Returner',
      });
      const shareId = created.share?.shareId as string;

      await readPage(ctx, shareId, { ip: '203.0.113.60' });

      // The same person, an hour later, same day. Past the repeat window so it is a second read —
      // but they are not a second person, and the visitor-day key is what knows the difference.
      const { AnalyticsRecorder } = await import('../../../src/services/analytics.js');
      const later = new AnalyticsRecorder({
        db: ctx.db,
        baseUrl: ctx.config.baseUrl,
        now: () => Date.now() + 60 * 60 * 1000,
        flushIntervalMs: 60_000,
      });
      later.capture({
        shareId,
        artifactId: created.artifact.id,
        accountId: ctx.account.id,
        versionNum: 1,
        isOwner: false,
        surface: 'page',
        facts: {
          method: 'GET',
          ip: '203.0.113.60',
          userAgent: READER_UA,
          referer: null,
          secPurpose: null,
          purpose: null,
          xMoz: null,
          secFetchDest: 'document',
        },
      });
      await later.flush();

      expect(shareCounters(ctx, shareId)).toMatchObject({
        view_count: 2,
        unique_viewer_count: 1,
      });
      const hashes = viewEvents(ctx, shareId).map((event) => event.visitor_hash);
      expect(hashes[0]).toBe(hashes[1]);
      // One ledger row for one reader on one day, however many times they came back.
      const ledger = ctx.db.sqlite
        .prepare('SELECT COUNT(*) AS count FROM share_visitor_days WHERE share_id = ?')
        .get(shareId) as { count: number };
      expect(ledger.count).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });

  it('cannot recognise yesterday, because yesterday’s salt is gone', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'rotation',
        title: 'Rotation',
        content: '# Rotation',
      });
      const shareId = created.share?.shareId as string;

      await readPage(ctx, shareId, { ip: '203.0.113.20' });
      const today = viewEvents(ctx, shareId)[0]?.visitor_hash;

      // Same reader, next day. A different salt means a different hash, by construction — which is
      // exactly why the two rows cannot be linked back to one person after the fact.
      const { AnalyticsRecorder } = await import('../../../src/services/analytics.js');
      const tomorrow = new AnalyticsRecorder({
        db: ctx.db,
        baseUrl: ctx.config.baseUrl,
        now: () => Date.now() + DAY_MS,
        flushIntervalMs: 60_000,
      });
      tomorrow.capture({
        shareId,
        artifactId: created.artifact.id,
        accountId: ctx.account.id,
        versionNum: 1,
        isOwner: false,
        surface: 'page',
        facts: {
          method: 'GET',
          ip: '203.0.113.20',
          userAgent: READER_UA,
          referer: null,
          secPurpose: null,
          purpose: null,
          xMoz: null,
          secFetchDest: 'document',
        },
      });
      await tomorrow.flush();

      const hashes = viewEvents(ctx, shareId).map((event) => event.visitor_hash);
      expect(hashes).toHaveLength(2);
      expect(hashes[1]).not.toBe(today);
      expect(shareCounters(ctx, shareId)).toMatchObject({
        view_count: 2,
        unique_viewer_count: 2,
      });

      const salts = ctx.db.sqlite
        .prepare('SELECT COUNT(*) AS count FROM analytics_salts')
        .get() as { count: number };
      expect(salts.count).toBe(2);
    } finally {
      await ctx.cleanup();
    }
  });

  it('records the referring host and nothing else about the referrer', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'referred',
        title: 'Referred',
        content: '# Referred',
      });
      const shareId = created.share?.shareId as string;

      await readPage(ctx, shareId, {
        ip: '203.0.113.30',
        headers: { referer: 'https://news.ycombinator.com/item?id=12345&secret=leaky' },
      });
      await readPage(ctx, shareId, {
        ip: '203.0.113.31',
        headers: { referer: `${ctx.config.baseUrl}/dashboard` },
      });

      const events = viewEvents(ctx, shareId);
      // The host, never the path — a query string is somebody else's data and has no business here.
      expect(events[0]?.referrer_host).toBe('news.ycombinator.com');
      // Arriving from our own page is navigation, not a referral.
      expect(events[1]?.referrer_host).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});

async function ownerSession(
  ctx: Awaited<ReturnType<typeof createViewerTestContext>>
): Promise<{ cookie: string }> {
  const { SessionService } = await import('../../../src/services/sessions.js');
  const sessions = new SessionService(ctx.db, ctx.config);
  const issued = await sessions.createSession(ctx.account.id);
  return { cookie: `${'aa_session'}=${issued.cookieValue}` };
}

/**
 * The same evidence as `tests/unit/bot-signatures.test.ts`, taken through the whole app rather than
 * against the classifier — because the classifier being right is worth nothing if the route forgets
 * to ask it. Every user agent here was measured incrementing BOTH counters on the previous build.
 */
describe('the traffic that used to inflate every number', () => {
  const INFLATORS: ReadonlyArray<readonly [string, string]> = [
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['GPTBot', 'Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)'],
    ['curl', 'curl/8.5.0'],
    ['python-requests', 'python-requests/2.31.0'],
    ['Slackbot', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
    ['empty user agent', ''],
  ];

  it('counts none of it, however many times it asks', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'crawled',
        title: 'Crawled',
        content: '# Crawled',
      });
      const shareId = created.share?.shareId as string;

      for (const [index, [name, ua]] of INFLATORS.entries()) {
        // Five hits each. On the old build this was five views AND five unique visitors per agent,
        // because the throttle keyed on a cookie none of them stores.
        for (let hit = 0; hit < 5; hit += 1) {
          const response = await ctx.app.request(`/a/${shareId}`, {
            headers: { 'user-agent': ua, 'x-forwarded-for': `203.0.113.${index + 40}` },
          });
          expect(response.status, name).toBe(200);
        }
      }
      await ctx.analytics.flush();

      // Thirty requests. Zero readers.
      expect(shareCounters(ctx, shareId)).toMatchObject({
        view_count: 0,
        unique_viewer_count: 0,
      });
      expect(viewEvents(ctx, shareId)).toHaveLength(0);

      // And a person arriving at the same artifact is still counted, so the filter is a filter and
      // not an off switch.
      await readPage(ctx, shareId, { ip: '203.0.113.99' });
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 1 });
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('the JavaScript confirmation', () => {
  it('marks a read as confirmed without ever creating or removing one', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'pulsed',
        title: 'Pulsed',
        content: '# Pulsed',
      });
      const shareId = created.share?.shareId as string;

      await readPage(ctx, shareId, { ip: '203.0.113.50' });
      expect(viewEvents(ctx, shareId)[0]?.js_confirmed).toBe(0);

      const pulse = await ctx.app.request(`/a/${shareId}/pulse`, {
        method: 'POST',
        headers: { 'user-agent': READER_UA, 'x-forwarded-for': '203.0.113.50' },
      });
      expect(pulse.status).toBe(204);
      await ctx.analytics.flush();

      const events = viewEvents(ctx, shareId);
      // Same read, now known to have executed our script. Still ONE read.
      expect(events).toHaveLength(1);
      expect(events[0]?.js_confirmed).toBe(1);
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 1 });
    } finally {
      await ctx.cleanup();
    }
  });

  it('creates nothing when it arrives without a read behind it', async () => {
    const ctx = await createViewerTestContext({ trustProxy: 1 });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'lonely-pulse',
        title: 'Lonely Pulse',
        content: '# Lonely Pulse',
      });
      const shareId = created.share?.shareId as string;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const pulse = await ctx.app.request(`/a/${shareId}/pulse`, {
          method: 'POST',
          headers: { 'user-agent': READER_UA, 'x-forwarded-for': '203.0.113.51' },
        });
        expect(pulse.status).toBe(204);
      }
      await ctx.analytics.flush();

      // A beacon is not a view. If this ever counts, the JS-blocking reader is being undercounted
      // again and we are back where we started.
      expect(shareCounters(ctx, shareId)).toMatchObject({ view_count: 0 });
      expect(viewEvents(ctx, shareId)).toHaveLength(0);
    } finally {
      await ctx.cleanup();
    }
  });
});
