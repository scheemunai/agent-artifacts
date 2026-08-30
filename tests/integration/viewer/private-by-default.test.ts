import { nanoid } from 'nanoid';
import { describe, expect, it } from 'vitest';
import type { Account } from '../../../src/extension/cloud-module.js';
import { ArtifactService } from '../../../src/services/artifacts.js';
import { SESSION_COOKIE_NAME, SessionService } from '../../../src/services/sessions.js';
import { insertAccount } from '../../unit/db-test-utils.js';
import {
  createTestBot,
  createViewerTestContext,
  publishSharedArtifact,
  type ViewerTestContext,
} from './viewer-test-utils.js';

/**
 * NEW ARTIFACTS ARE PRIVATE, AND PRIVATE MEANS INVISIBLE.
 *
 * `share: true` used to publish to the whole internet in the same call that created the artifact —
 * and the published contract taught agents to send it. An agent doing what it was told produced a
 * world-readable URL for a document nobody had decided to publish.
 *
 * Now creation always mints a private URL, publishing is a separate deliberate act, and a stranger
 * hitting a private share gets the same answer as a stranger hitting a share id that was never
 * issued: `not_found`. Not "forbidden", not "revoked" — those tell an enumerator which ids are real.
 */

const SECRET = 'CONFIDENTIAL-PRIVATE-BODY';

async function ownerCookie(ctx: ViewerTestContext): Promise<string> {
  const session = await new SessionService(ctx.db, ctx.config).createSession(ctx.account.id);
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
}

async function strangerCookie(ctx: ViewerTestContext): Promise<string> {
  const account: Account = {
    id: `acc_${nanoid(21)}`,
    email: `stranger-${nanoid(8)}@example.test`,
    suspendedAt: null,
  };
  insertAccount(ctx.db, account);
  const session = await new SessionService(ctx.db, ctx.config).createSession(account.id);
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
}

function artifacts(ctx: ViewerTestContext): ArtifactService {
  return new ArtifactService({
    db: ctx.db,
    extension: ctx.cloudModule,
    baseUrl: ctx.config.baseUrl,
  });
}

/** Creates through the real v1 route, so the request fields are exercised as an agent sends them. */
async function createViaApi(
  ctx: ViewerTestContext,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const bot = await createTestBot(ctx);
  const response = await ctx.app.request('/v1/artifacts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${bot.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'markdown',
      title: 'Private probe',
      content: `# Body\n\n${SECRET}`,
      ...body,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Record<string, unknown>;
}

/** Every surface a share id exposes. If one of them forgets, the artifact is not private. */
const SURFACES = ['', '/content', '/download', '/frame', '/og.png'] as const;

describe('artifacts are private when they are created', () => {
  it('creates privately no matter what the caller asks for', async () => {
    const ctx = await createViewerTestContext();

    try {
      for (const [label, body] of [
        ['nothing asked', {}],
        ['share:true', { share: true }],
        ['password', { password: 'hunter22' }],
        ['both', { share: true, password: 'hunter22' }],
      ] as const) {
        const created = await createViaApi(ctx, {
          slug: `create-${label.replace(/\W+/g, '-')}`,
          ...body,
        });
        const share = created.share as Record<string, unknown>;

        expect(share.visibility, `${label} should still be private`).toBe('private');
        expect(share.url, `${label} should still get a URL`).toContain('/a/');
        expect(share.note, `${label} should say what happened`).toContain('private');
        expect(share.password_protected).toBe(false);

        const row = ctx.db.sqlite
          .prepare('SELECT visibility, password_hash FROM shares WHERE id = ?')
          .get(share.share_id) as { visibility: string; password_hash: string | null };
        expect(row.visibility).toBe('private');
        // Dropped, not stored: a hash with no gate in front of it is a credential at rest.
        expect(row.password_hash).toBeNull();
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('names the fields it ignored, so an agent is not left to find out from a human', async () => {
    const ctx = await createViewerTestContext();

    try {
      const asked = await createViaApi(ctx, {
        slug: 'asked-to-publish',
        share: true,
        password: 'hunter22',
      });
      expect((asked.share as Record<string, unknown>).ignored_request).toEqual([
        'share',
        'password',
      ]);

      const quiet = await createViaApi(ctx, { slug: 'asked-for-nothing' });
      expect((quiet.share as Record<string, unknown>).ignored_request).toBeUndefined();
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('a private artifact is invisible to everyone but its owner', () => {
  it('answers 404 on every surface, logged out and as another account', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await createViaApi(ctx, { slug: 'invisible' });
      const shareId = (created.share as { share_id: string }).share_id;
      const stranger = await strangerCookie(ctx);

      for (const surface of SURFACES) {
        for (const [who, headers] of [
          ['logged out', {}],
          ['another account', { Cookie: stranger }],
        ] as const) {
          const response = await ctx.app.request(`/a/${shareId}${surface}`, { headers });
          expect(response.status, `${surface || '/a'} as ${who}`).toBe(404);
          const body = await response.text();
          expect(body, `${surface || '/a'} as ${who} leaked the body`).not.toContain(SECRET);
        }
      }

      // The password endpoint is a surface too: answering it differently would confirm the id.
      const verify = await ctx.app.request(`/a/${shareId}/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'guess' }),
      });
      expect(verify.status).toBe(404);
    } finally {
      await ctx.cleanup();
    }
  });

  it('is byte-for-byte indistinguishable from an id that never existed', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await createViaApi(ctx, { slug: 'indistinguishable' });
      const shareId = (created.share as { share_id: string }).share_id;
      const neverExisted = 'AAAAAAAAAAAAAAAAAAAAAA';

      // The terminal page echoes the URL that was requested, so the two bodies necessarily differ
      // by the id the caller already typed. Everything ELSE must match: the status, the copy, the
      // headers. Normalising the id out is what makes the comparison mean "these say the same
      // thing" rather than "these are the same string".
      const withoutId = (body: string, id: string) => body.split(id).join('<SHARE_ID>');

      for (const surface of SURFACES) {
        const [privateResponse, unknownResponse] = await Promise.all([
          ctx.app.request(`/a/${shareId}${surface}`),
          ctx.app.request(`/a/${neverExisted}${surface}`),
        ]);

        expect(privateResponse.status, `${surface || '/a'} status`).toBe(unknownResponse.status);
        expect(withoutId(await privateResponse.text(), shareId), `${surface || '/a'} body`).toBe(
          withoutId(await unknownResponse.text(), neverExisted)
        );
        for (const header of ['content-type', 'cache-control', 'etag']) {
          expect(privateResponse.headers.get(header), `${surface || '/a'} ${header}`).toBe(
            unknownResponse.headers.get(header)
          );
        }
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('never lets a CDN cache the refused social card', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await createViaApi(ctx, { slug: 'no-og-preview' });
      const shareId = (created.share as { share_id: string }).share_id;

      const refused = await ctx.app.request(`/a/${shareId}/og.png`);
      expect(refused.status).toBe(404);
      // `public, max-age=3600` here would keep a private artifact's title and author in a shared
      // cache for an hour after the gate said no.
      expect(refused.headers.get('cache-control')).toBe('no-store');
    } finally {
      await ctx.cleanup();
    }
  });

  it('lets the owner read their own artifact on the surfaces that serve them', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await createViaApi(ctx, { slug: 'owner-can-read' });
      const shareId = (created.share as { share_id: string }).share_id;
      const Cookie = await ownerCookie(ctx);

      const page = await ctx.app.request(`/a/${shareId}`, { headers: { Cookie } });
      expect(page.status).toBe(200);
      expect(await page.text()).toContain(SECRET);

      const content = await ctx.app.request(`/a/${shareId}/content`, { headers: { Cookie } });
      expect(content.status).toBe(200);

      const download = await ctx.app.request(`/a/${shareId}/download`, { headers: { Cookie } });
      expect(download.status).toBe(200);
      await expect(download.text()).resolves.toContain(SECRET);

      const og = await ctx.app.request(`/a/${shareId}/og.png`, { headers: { Cookie } });
      expect(og.status).toBe(200);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('publishing is the explicit act', () => {
  it('publishes to everyone without changing the URL', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await createViaApi(ctx, { slug: 'publish-me' });
      const shareId = (created.share as { share_id: string }).share_id;

      expect((await ctx.app.request(`/a/${shareId}`)).status).toBe(404);

      const published = await artifacts(ctx).createShare({
        account: ctx.account,
        idOrSlug: 'publish-me',
      });
      // The URL an agent already handed over is the URL that goes live.
      expect(published.share.shareId).toBe(shareId);
      expect(published.share.visibility).toBe('public');

      const open = await ctx.app.request(`/a/${shareId}`);
      expect(open.status).toBe(200);
      expect(await open.text()).toContain(SECRET);
    } finally {
      await ctx.cleanup();
    }
  });

  it('gates a published artifact behind a password when one is set', async () => {
    const ctx = await createViewerTestContext();

    try {
      const published = await publishSharedArtifact(ctx, {
        slug: 'gated',
        password: 'hunter22',
        content: `# Body\n\n${SECRET}`,
      });
      const shareId = published.share?.shareId as string;

      const page = await ctx.app.request(`/a/${shareId}/content`);
      expect(page.status).toBe(401);
      expect(await page.text()).not.toContain(SECRET);
    } finally {
      await ctx.cleanup();
    }
  });

  it('unpublishes back to private, reversibly, keeping the URL', async () => {
    const ctx = await createViewerTestContext();

    try {
      const published = await publishSharedArtifact(ctx, {
        slug: 'unpublish-me',
        content: `# Body\n\n${SECRET}`,
      });
      const shareId = published.share?.shareId as string;
      expect((await ctx.app.request(`/a/${shareId}`)).status).toBe(200);

      const unpublished = await artifacts(ctx).unpublishShare({
        account: ctx.account,
        idOrSlug: 'unpublish-me',
      });
      expect(unpublished?.visibility).toBe('private');
      expect(unpublished?.shareId).toBe(shareId);
      expect((await ctx.app.request(`/a/${shareId}`)).status).toBe(404);

      // Reversible, and on the SAME url — that is the difference from revoking.
      const republished = await artifacts(ctx).createShare({
        account: ctx.account,
        idOrSlug: 'unpublish-me',
      });
      expect(republished.share.shareId).toBe(shareId);
      expect((await ctx.app.request(`/a/${shareId}`)).status).toBe(200);
    } finally {
      await ctx.cleanup();
    }
  });

  it('revokes for good: 410 forever, and a new id next time', async () => {
    const ctx = await createViewerTestContext();

    try {
      const published = await publishSharedArtifact(ctx, {
        slug: 'burn-me',
        content: `# Body\n\n${SECRET}`,
      });
      const shareId = published.share?.shareId as string;

      await artifacts(ctx).revokeShare({ account: ctx.account, idOrSlug: 'burn-me' });

      const dead = await ctx.app.request(`/a/${shareId}`);
      expect(dead.status).toBe(410);

      const reissued = await artifacts(ctx).createShare({
        account: ctx.account,
        idOrSlug: 'burn-me',
      });
      expect(reissued.share.shareId).not.toBe(shareId);
      // The burned link stays burned.
      expect((await ctx.app.request(`/a/${shareId}`)).status).toBe(410);
    } finally {
      await ctx.cleanup();
    }
  });

  it('leaves artifacts that were already public alone', async () => {
    // The migration records what a live link already is. A share row created before the column
    // existed is public RIGHT NOW, and the deploy that adds the column must not take it dark.
    const ctx = await createViewerTestContext();

    try {
      const published = await publishSharedArtifact(ctx, {
        slug: 'already-public',
        content: `# Body\n\n${SECRET}`,
      });
      const shareId = published.share?.shareId as string;

      // Exactly what the forward migration's backfill writes for a pre-existing row.
      ctx.db.sqlite
        .prepare(
          `UPDATE shares
           SET visibility = CASE WHEN password_hash IS NOT NULL THEN 'password' ELSE 'public' END
           WHERE id = ?`
        )
        .run(shareId);

      const open = await ctx.app.request(`/a/${shareId}`);
      expect(open.status).toBe(200);
      expect(await open.text()).toContain(SECRET);
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('a grant cannot outlive the visibility that issued it', () => {
  it('stops honouring a frame version grant once the artifact is private', async () => {
    const ctx = await createViewerTestContext({ sandboxOrigin: 'https://sandbox.example.test' });

    try {
      const published = await publishSharedArtifact(ctx, {
        slug: 'grant-lifetime',
        type: 'html',
        content: `<p>${SECRET}</p>`,
      });
      const shareId = published.share?.shareId as string;
      await artifacts(ctx).upsertArtifact({
        account: ctx.account,
        bot: null,
        slug: 'grant-lifetime',
        type: 'html',
        title: 'Second',
        content: '<p>Corrected.</p>',
      });

      const Cookie = await ownerCookie(ctx);
      const content = await ctx.app.request(`/a/${shareId}/content?v=1`, { headers: { Cookie } });
      const grant = new URL(
        ((await content.json()) as { frame_url: string }).frame_url
      ).searchParams.get('vt');
      expect(grant).toBeTruthy();

      await artifacts(ctx).unpublishShare({ account: ctx.account, idOrSlug: 'grant-lifetime' });

      // The grant is still cryptographically valid; the artifact is simply no longer readable by
      // its bearer. Visibility is checked before the grant is ever considered.
      const framed = await ctx.app.request(
        `/a/${shareId}/frame?v=1&vt=${encodeURIComponent(grant ?? '')}`,
        { headers: { Host: 'sandbox.example.test' } }
      );
      expect(framed.status).toBe(404);
      await expect(framed.text()).resolves.not.toContain(SECRET);
    } finally {
      await ctx.cleanup();
    }
  });
});
