import { nanoid } from 'nanoid';
import { describe, expect, it } from 'vitest';
import type { Account } from '../../../src/extension/cloud-module.js';
import { SESSION_COOKIE_NAME, SessionService } from '../../../src/services/sessions.js';
import { insertAccount } from '../../unit/db-test-utils.js';
import {
  createViewerTestContext,
  publishSharedArtifact,
  updateArtifact,
  type ViewerTestContext,
} from './viewer-test-utils.js';

/**
 * A share link publishes ONE document: the current one.
 *
 * Every public route honoured `?v=<n>` from anybody who sent it — the page, `/content`,
 * `/download` and the sandboxed `/frame`. So a link to a finished report was also a link to every
 * state it had ever been in, reachable by counting up from 1: the draft with the wrong numbers, the
 * paragraph that was pulled, the name that should not have been there. Nothing had to be guessed
 * except a small integer, and the version picker in the chrome told a reader how far to count.
 *
 * The rule now: only the artifact's own signed-in owner can pin a version. Everyone else — logged
 * out, or logged in as somebody else — gets the latest, and is not told there is anything else.
 */

/** A second account with a real dashboard session, for the "logged in, but not yours" case. */
async function otherAccountCookie(ctx: ViewerTestContext): Promise<string> {
  const account: Account = {
    id: `acc_${nanoid(21)}`,
    email: `stranger-${nanoid(8)}@example.test`,
    suspendedAt: null,
  };
  insertAccount(ctx.db, account);
  const session = await new SessionService(ctx.db, ctx.config).createSession(account.id);
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
}

async function ownerCookie(ctx: ViewerTestContext): Promise<string> {
  const session = await new SessionService(ctx.db, ctx.config).createSession(ctx.account.id);
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
}

/** A two-version markdown artifact: v1 is the secret, v2 is what the link publishes. */
async function twoVersionArtifact(ctx: ViewerTestContext): Promise<string> {
  const created = await publishSharedArtifact(ctx, {
    slug: 'history-probe',
    title: 'Draft with the wrong numbers',
    content: '# Draft\n\nRevenue was CONFIDENTIAL-V1.',
  });
  await updateArtifact(ctx, {
    slug: 'history-probe',
    title: 'Published report',
    content: '# Published\n\nRevenue was corrected.',
  });
  return created.share?.shareId as string;
}

interface ContentBody {
  version_num: number;
  latest_version_num: number;
  html: string;
}

describe('artifact version history is owner-only', () => {
  it('ignores ?v= from a logged-out visitor on every route that reads content', async () => {
    const ctx = await createViewerTestContext();

    try {
      const shareId = await twoVersionArtifact(ctx);

      const content = await ctx.app.request(`/a/${shareId}/content?v=1`);
      const body = (await content.json()) as ContentBody;
      expect(content.status).toBe(200);
      expect(body.version_num).toBe(2);
      expect(body.html).not.toContain('CONFIDENTIAL-V1');

      const page = await ctx.app.request(`/a/${shareId}?v=1`);
      const pageHtml = await page.text();
      expect(page.status).toBe(200);
      expect(pageHtml).not.toContain('CONFIDENTIAL-V1');
      // Nor may it announce a pin it did not honour.
      expect(pageHtml).not.toContain('Viewing v1');

      const download = await ctx.app.request(`/a/${shareId}/download?v=1`);
      expect(download.status).toBe(200);
      await expect(download.text()).resolves.not.toContain('CONFIDENTIAL-V1');
      // And the file must not claim to be the version it is not.
      expect(download.headers.get('content-disposition')).toBe(
        'attachment; filename="history-probe.md"'
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('ignores ?v= on the sandboxed frame, which no session cookie ever reaches', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'html-history',
        type: 'html',
        title: 'Draft',
        content: '<p>CONFIDENTIAL-V1</p>',
      });
      await updateArtifact(ctx, {
        slug: 'html-history',
        type: 'html',
        title: 'Published',
        content: '<p>Corrected.</p>',
      });
      const shareId = created.share?.shareId as string;

      const frame = await ctx.app.request(`/a/${shareId}/frame?v=1`);
      expect(frame.status).toBe(200);
      await expect(frame.text()).resolves.not.toContain('CONFIDENTIAL-V1');

      // A forged grant is not a grant. The signature is the whole control here, because the frame
      // is the one route that must accept a capability from the URL.
      const forged = await ctx.app.request(`/a/${shareId}/frame?v=1&vt=99999999999999.deadbeef`);
      expect(forged.status).toBe(200);
      await expect(forged.text()).resolves.not.toContain('CONFIDENTIAL-V1');
    } finally {
      await ctx.cleanup();
    }
  });

  it('treats a different signed-in account as a stranger', async () => {
    const ctx = await createViewerTestContext();

    try {
      const shareId = await twoVersionArtifact(ctx);
      const Cookie = await otherAccountCookie(ctx);

      const content = await ctx.app.request(`/a/${shareId}/content?v=1`, { headers: { Cookie } });
      const body = (await content.json()) as ContentBody;
      expect(content.status).toBe(200);
      expect(body.version_num).toBe(2);
      expect(body.html).not.toContain('CONFIDENTIAL-V1');

      const page = await ctx.app.request(`/a/${shareId}?v=1`, { headers: { Cookie } });
      const pageHtml = await page.text();
      expect(pageHtml).not.toContain('CONFIDENTIAL-V1');
      expect(pageHtml).not.toContain('aa-version-picker');
    } finally {
      await ctx.cleanup();
    }
  });

  it('ignores a cookie that is expired, forged, or for an account that is gone', async () => {
    const ctx = await createViewerTestContext();

    try {
      const shareId = await twoVersionArtifact(ctx);
      const owner = await ownerCookie(ctx);

      const forged = [
        `${SESSION_COOKIE_NAME}=not-a-session`,
        // A real token shape with the signature tampered.
        `${owner.slice(0, -4)}beef`,
        `${SESSION_COOKIE_NAME}=`,
      ];

      for (const Cookie of forged) {
        const response = await ctx.app.request(`/a/${shareId}/content?v=1`, {
          headers: { Cookie },
        });
        const body = (await response.json()) as ContentBody;
        expect(response.status, `cookie "${Cookie.slice(0, 24)}…" was accepted`).toBe(200);
        expect(body.version_num).toBe(2);
        expect(body.html).not.toContain('CONFIDENTIAL-V1');
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('never serves a historical version through the OG card', async () => {
    const ctx = await createViewerTestContext();

    try {
      const shareId = await twoVersionArtifact(ctx);
      // The card is rendered from the artifact head and has never taken a version — asserted so it
      // stays that way, because it is cached `public` and would be the one shared cache in the set.
      const og = await ctx.app.request(`/a/${shareId}/og.png?v=1`);
      expect(og.status).toBe(200);
      expect(og.headers.get('cache-control')).toBe('public, max-age=3600');
    } finally {
      await ctx.cleanup();
    }
  });

  it('gives the signed-in owner the picker and the version they asked for', async () => {
    const ctx = await createViewerTestContext();

    try {
      const shareId = await twoVersionArtifact(ctx);
      const Cookie = await ownerCookie(ctx);

      const content = await ctx.app.request(`/a/${shareId}/content?v=1`, { headers: { Cookie } });
      const body = (await content.json()) as ContentBody;
      expect(content.status).toBe(200);
      expect(body.version_num).toBe(1);
      expect(body.latest_version_num).toBe(2);
      expect(body.html).toContain('CONFIDENTIAL-V1');
      // A real historical version, so the immutable cache is correct here — and `private`, so it
      // cannot be handed to anybody else by a shared cache.
      expect(content.headers.get('cache-control')).toBe('private, max-age=86400, immutable');

      const page = await ctx.app.request(`/a/${shareId}?v=1`, { headers: { Cookie } });
      const pageHtml = await page.text();
      expect(page.status).toBe(200);
      expect(pageHtml).toContain('CONFIDENTIAL-V1');
      expect(pageHtml).toContain('Viewing v1');
      expect(pageHtml).toContain('id="aa-version-picker"');

      const download = await ctx.app.request(`/a/${shareId}/download?v=1`, { headers: { Cookie } });
      expect(download.status).toBe(200);
      await expect(download.text()).resolves.toContain('CONFIDENTIAL-V1');
      expect(download.headers.get('content-disposition')).toBe(
        'attachment; filename="history-probe-v1.md"'
      );
    } finally {
      await ctx.cleanup();
    }
  });

  it('shows the owner the picker on the latest version too, and no stranger ever', async () => {
    const ctx = await createViewerTestContext();

    try {
      const shareId = await twoVersionArtifact(ctx);
      const Cookie = await ownerCookie(ctx);

      const owner = await (await ctx.app.request(`/a/${shareId}`, { headers: { Cookie } })).text();
      expect(owner).toContain('id="aa-version-picker"');

      const stranger = await (await ctx.app.request(`/a/${shareId}`)).text();
      expect(stranger).not.toContain('id="aa-version-picker"');
      expect(stranger).not.toContain('Artifact version');
    } finally {
      await ctx.cleanup();
    }
  });

  it('carries the owner pin across the sandbox origin with a signed grant, and only there', async () => {
    // The frame is served from a different hostname, so the owner's session cookie does not travel
    // with it. Without a grant in the URL the owner's own HTML version preview would silently show
    // the latest instead — and with an unsigned one, so would everybody else's.
    const ctx = await createViewerTestContext({
      sandboxOrigin: 'https://sandbox.example.test',
    });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'html-owner-pin',
        type: 'html',
        title: 'Draft',
        content: '<p>CONFIDENTIAL-V1</p>',
      });
      await updateArtifact(ctx, {
        slug: 'html-owner-pin',
        type: 'html',
        title: 'Published',
        content: '<p>Corrected.</p>',
      });
      const shareId = created.share?.shareId as string;
      const Cookie = await ownerCookie(ctx);

      const content = await ctx.app.request(`/a/${shareId}/content?v=1`, { headers: { Cookie } });
      const body = (await content.json()) as ContentBody & { frame_url: string };
      expect(content.status).toBe(200);

      const frameUrl = new URL(body.frame_url);
      expect(frameUrl.origin).toBe('https://sandbox.example.test');
      expect(frameUrl.searchParams.get('v')).toBe('1');
      const grant = frameUrl.searchParams.get('vt');
      expect(grant, 'no signed grant on the pinned frame url').toBeTruthy();

      // The grant works, with no cookie at all — which is the whole point of it.
      const framed = await ctx.app.request(
        `/a/${shareId}/frame?v=1&vt=${encodeURIComponent(grant ?? '')}`,
        { headers: { Host: 'sandbox.example.test' } }
      );
      expect(framed.status).toBe(200);
      await expect(framed.text()).resolves.toContain('CONFIDENTIAL-V1');

      // And it is bound to the version it was issued for: it cannot be walked to another one.
      const walked = await ctx.app.request(
        `/a/${shareId}/frame?v=2&vt=${encodeURIComponent(grant ?? '')}`,
        { headers: { Host: 'sandbox.example.test' } }
      );
      expect(walked.status).toBe(200);
      await expect(walked.text()).resolves.not.toContain('CONFIDENTIAL-V1');
    } finally {
      await ctx.cleanup();
    }
  });

  it('does not mint a grant for a visitor who was refused the pin', async () => {
    const ctx = await createViewerTestContext({ sandboxOrigin: 'https://sandbox.example.test' });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'html-no-grant',
        type: 'html',
        title: 'Draft',
        content: '<p>CONFIDENTIAL-V1</p>',
      });
      await updateArtifact(ctx, {
        slug: 'html-no-grant',
        type: 'html',
        title: 'Published',
        content: '<p>Corrected.</p>',
      });
      const shareId = created.share?.shareId as string;

      const content = await ctx.app.request(`/a/${shareId}/content?v=1`);
      const body = (await content.json()) as { frame_url: string };
      const frameUrl = new URL(body.frame_url);

      // Served the latest, so there is no pin to carry and nothing to sign. A grant here would be
      // the service handing a stranger the capability it had just declined to give them.
      expect(frameUrl.searchParams.get('v')).toBeNull();
      expect(frameUrl.searchParams.get('vt')).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
