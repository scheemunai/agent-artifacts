import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import {
  OWNER_PREVIEW_TTL_MS,
  previewContentDigest,
  signOwnerPreviewToken,
} from '../../src/lib/preview-token.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { type AuthTestContext, createAuthTestContext, login } from './auth-test-utils.js';

/**
 * The owner's "Rendered preview", and the defect that made it blank on cloud.
 *
 * ── THE BUG, AND WHY EVERY EXISTING TEST WAS GREEN THROUGH IT ──────────────────────────────────
 *
 * The dashboard's CSP is `frame-src ${config.frameOrigin}`, and `frameOrigin` is `SANDBOX_ORIGIN`
 * when there is one and `'self'` when there is not. The preview iframe pointed at a *relative*
 * `/dashboard/artifacts/:id/frame`, which resolves to the dashboard's own origin. On self-hosted
 * those two are the same string and the frame loaded; on cloud the dashboard origin is not in its
 * own `frame-src` and the browser refused the load outright.
 *
 * Nothing caught it because every test of that route requested it DIRECTLY — a 200 with the right
 * headers, asserted from a client that has no CSP. The CSP is enforced by the embedder, not the
 * response, so a frame route can be perfectly correct and still never render. The assertions here
 * are therefore about the relationship between two responses: the origin the dashboard page puts
 * in the `src`, and the origin its own CSP admits.
 *
 * `SANDBOX_ORIGIN` is set on a self-hosted deployment below rather than using `DEPLOYMENT=cloud`,
 * for one reason: cloud disables password login, and what is under test is the frame origin, which
 * is governed by `SANDBOX_ORIGIN` alone. `tests/e2e/owner-preview.spec.ts` drives the real cloud
 * deployment in a real browser, which is where the CSP is actually enforced.
 */

const SANDBOX_ORIGIN = 'https://usercontent.example.test';

let contexts: AuthTestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.map((ctx) => ctx.cleanup()));
  contexts = [];
});

interface Seeded {
  cookie: string;
  accountId: string;
  htmlArtifactId: string;
  htmlContent: string;
  markdownArtifactId: string;
  htmlTemplateId: string;
}

async function makeContext(sandboxOrigin: string | undefined): Promise<AuthTestContext> {
  const ctx = await createAuthTestContext(sandboxOrigin ? { SANDBOX_ORIGIN: sandboxOrigin } : {});
  contexts.push(ctx);
  return ctx;
}

async function seed(ctx: AuthTestContext, email = 'preview-owner@example.test'): Promise<Seeded> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount(email, 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Preview Bot');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const htmlContent = '<h1>Owner preview body</h1><p>Rendered on the sandbox host.</p>';
  const html = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: `owner-preview-html-${email.split('@')[0]}`,
    type: 'html',
    title: 'Owner Preview HTML',
    content: htmlContent,
    share: false,
  });
  const markdown = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: `owner-preview-md-${email.split('@')[0]}`,
    type: 'markdown',
    title: 'Owner Preview Markdown',
    content: '# Owner Preview Markdown\n\nInline, never framed.',
    share: false,
  });

  return {
    cookie: await login(ctx, email, 'password123'),
    accountId: account.id,
    htmlArtifactId: html.artifact.id,
    htmlContent,
    markdownArtifactId: markdown.artifact.id,
    htmlTemplateId: (
      ctx.db.sqlite
        .prepare('SELECT id FROM templates WHERE slug = ? AND account_id IS NULL')
        .get('daily-digest') as { id: string }
    ).id,
  };
}

async function pageHtml(ctx: AuthTestContext, path: string, cookie: string): Promise<string> {
  const response = await ctx.app.request(path, { headers: { Cookie: cookie } });
  expect(response.status, path).toBe(200);
  return response.text();
}

/** The `src` of the one preview iframe on a page. */
function previewSrc(html: string): string {
  const match = html.match(/<iframe[^>]*\ssrc="([^"]*\/preview\/[^"]*)"/);
  expect(match?.[1], 'the page rendered no owner preview iframe').toBeDefined();
  return (match as RegExpMatchArray)[1] as string;
}

function frameSrcDirective(html: string, csp: string | null): string {
  expect(csp, 'the dashboard page carried no CSP').not.toBeNull();
  void html;
  const directive = (csp as string).split('; ').find((entry) => entry.startsWith('frame-src '));
  expect(directive, 'the dashboard page CSP declares no frame-src').toBeDefined();
  return directive as string;
}

describe('the owner preview is framed from an origin the dashboard is allowed to frame', () => {
  it('puts the artifact preview on the sandbox origin when there is one', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, htmlArtifactId } = await seed(ctx);

    const page = await ctx.app.request(`/dashboard/artifacts/${htmlArtifactId}`, {
      headers: { Cookie: cookie },
    });
    const html = await page.text();
    const src = previewSrc(html);

    // THE REGRESSION, IN ONE LINE. Before the fix this was `/dashboard/artifacts/:id/frame` — a
    // relative URL on the dashboard origin, which the directive below does not admit.
    expect(new URL(src).origin).toBe(SANDBOX_ORIGIN);
    expect(frameSrcDirective(html, page.headers.get('content-security-policy'))).toBe(
      `frame-src ${SANDBOX_ORIGIN}`
    );
    expect(html).toContain('sandbox="allow-scripts"');
  });

  it('puts the template preview on the sandbox origin too', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, htmlTemplateId } = await seed(ctx);

    const page = await ctx.app.request(`/dashboard/templates?preview=${htmlTemplateId}`, {
      headers: { Cookie: cookie },
    });
    const html = await page.text();

    expect(new URL(previewSrc(html)).origin).toBe(SANDBOX_ORIGIN);
    expect(frameSrcDirective(html, page.headers.get('content-security-policy'))).toBe(
      `frame-src ${SANDBOX_ORIGIN}`
    );
  });

  it('keeps the self-hosted preview same-origin, which its own frame-src admits', async () => {
    // The other half of the fix: one host, so the preview is same-origin and `frame-src 'self'`
    // permits it. A fix that only worked on cloud would have moved the outage rather than closed
    // it.
    const ctx = await makeContext(undefined);
    const { cookie, htmlArtifactId } = await seed(ctx);

    const page = await ctx.app.request(`/dashboard/artifacts/${htmlArtifactId}`, {
      headers: { Cookie: cookie },
    });
    const html = await page.text();

    expect(new URL(previewSrc(html)).origin).toBe(new URL(ctx.config.baseUrl).origin);
    expect(frameSrcDirective(html, page.headers.get('content-security-policy'))).toBe(
      "frame-src 'self'"
    );
  });

  it('frames nothing for markdown, which previews inline', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, markdownArtifactId } = await seed(ctx);

    const html = await pageHtml(ctx, `/dashboard/artifacts/${markdownArtifactId}`, cookie);

    expect(html).toContain('data-aa-dashboard-preview="markdown"');
    expect(html).not.toContain('/preview/');
  });

  it('mints a new URL when the content changes, so nothing can serve a stale preview', async () => {
    // Why the content hash is in the signed payload. An agent republishing an artifact must not
    // leave the owner looking at the previous revision because something between them cached a
    // URL that no longer describes what it returns.
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, accountId, htmlArtifactId } = await seed(ctx);
    const before = previewSrc(
      await pageHtml(ctx, `/dashboard/artifacts/${htmlArtifactId}`, cookie)
    );

    const artifacts = new ArtifactService({
      db: ctx.db,
      extension: createDefaultCloudModule(ctx.config),
      baseUrl: ctx.config.baseUrl,
    });
    await artifacts.upsertArtifact({
      account: { id: accountId, email: 'preview-owner@example.test', suspendedAt: null },
      bot: null,
      slug: 'owner-preview-html-preview-owner',
      type: 'html',
      title: 'Owner Preview HTML',
      content: '<h1>Owner preview body, revised</h1>',
      share: false,
    });

    const after = previewSrc(await pageHtml(ctx, `/dashboard/artifacts/${htmlArtifactId}`, cookie));

    expect(after).not.toBe(before);
    await expect((await ctx.app.request(after)).text()).resolves.toBe(
      '<h1>Owner preview body, revised</h1>'
    );
  });
});

describe('the owner preview frame route', () => {
  it('serves the owner content on the sandbox host with no cookie at all', async () => {
    // The whole reason a token exists. The sandbox host is cross-origin, so the browser never
    // sends it the dashboard session; if this route needed one it could not answer.
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, htmlArtifactId, htmlContent } = await seed(ctx);
    const src = previewSrc(await pageHtml(ctx, `/dashboard/artifacts/${htmlArtifactId}`, cookie));

    const framed = await ctx.app.request(src);

    expect(framed.status).toBe(200);
    expect(await framed.text()).toBe(htmlContent);
    expect(framed.headers.get('set-cookie')).toBeNull();
  });

  it('is admitted by the sandbox host guard, which 404s everything else there', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, htmlArtifactId } = await seed(ctx);
    const src = previewSrc(await pageHtml(ctx, `/dashboard/artifacts/${htmlArtifactId}`, cookie));

    expect((await ctx.app.request(src)).status).toBe(200);
    // Neighbouring shapes the guard must still refuse, so "allowed" stays a path and not a prefix.
    for (const path of ['/preview', '/preview/x/frame', `${new URL(src).pathname}/extra`]) {
      const response = await ctx.app.request(`${SANDBOX_ORIGIN}${path}`);
      expect(response.status, path).toBe(404);
      await expect(response.text(), path).resolves.toBe('Not found');
    }
  });

  it('carries the owner-preview frame policy, naming the app origin as the only embedder', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, htmlArtifactId } = await seed(ctx);
    const src = previewSrc(await pageHtml(ctx, `/dashboard/artifacts/${htmlArtifactId}`, cookie));

    const framed = await ctx.app.request(src);
    const csp = framed.headers.get('content-security-policy') ?? '';

    expect(csp).toBe(
      [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        'img-src data: https:',
        "font-src 'none'",
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        `frame-ancestors ${new URL(ctx.config.baseUrl).origin}`,
        'sandbox allow-scripts',
      ].join('; ')
    );
    expect(framed.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(framed.headers.get('x-content-type-options')).toBe('nosniff');
    // Private content on a URL that travels through cloud infrastructure. Never cached.
    expect(framed.headers.get('cache-control')).toBe('no-store');
    expect(framed.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(framed.headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=()'
    );
  });

  it("keeps 'self' as the embedder on self-hosted, where the two hosts are one", async () => {
    const ctx = await makeContext(undefined);
    const { cookie, htmlArtifactId, htmlContent } = await seed(ctx);
    const src = previewSrc(await pageHtml(ctx, `/dashboard/artifacts/${htmlArtifactId}`, cookie));

    const framed = await ctx.app.request(src);

    expect(framed.status).toBe(200);
    expect(await framed.text()).toBe(htmlContent);
    expect(framed.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
  });

  it('redirects a preview URL that landed on the app host to the sandbox host', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, htmlArtifactId } = await seed(ctx);
    const path = new URL(
      previewSrc(await pageHtml(ctx, `/dashboard/artifacts/${htmlArtifactId}`, cookie))
    ).pathname;

    const response = await ctx.app.request(`${ctx.config.baseUrl}${path}`, {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(`${SANDBOX_ORIGIN}${path}`);
  });

  it('serves a template the same way, raw and account-scoped', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, htmlTemplateId } = await seed(ctx);
    const src = previewSrc(
      await pageHtml(ctx, `/dashboard/templates?preview=${htmlTemplateId}`, cookie)
    );

    const framed = await ctx.app.request(src);
    const stored = (
      ctx.db.sqlite.prepare('SELECT content FROM templates WHERE id = ?').get(htmlTemplateId) as {
        content: string;
      }
    ).content;

    expect(framed.status).toBe(200);
    // Raw, exactly as the route it replaced served it: a template promoted from an artifact must
    // not preview differently here than on the page it was promoted from.
    expect(await framed.text()).toBe(stored);
  });
});

describe('the owner preview frame refuses everything it was not minted for', () => {
  it('refuses an expired token', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { accountId, htmlArtifactId } = await seed(ctx);
    const token = signOwnerPreviewToken(ctx.config.sessionSecret, {
      accountId,
      subject: 'artifact',
      subjectId: htmlArtifactId,
      contentHash: 'a'.repeat(64),
      expiresAt: Date.now() - 1,
    });

    const response = await ctx.app.request(`${SANDBOX_ORIGIN}/preview/${token}/frame`);

    expect(response.status).toBe(404);
    // The sandbox origin cannot load the app stylesheet, so a failure here reuses the public
    // frame's self-contained terminal document rather than emitting two words of monospace.
    expect(await response.text()).toContain('This artifact isn&#39;t available here.');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('refuses a token signed with a secret that is not this instance', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { accountId, htmlArtifactId } = await seed(ctx);
    const token = signOwnerPreviewToken('an-attackers-secret-of-at-least-32-bytes-long', {
      accountId,
      subject: 'artifact',
      subjectId: htmlArtifactId,
      contentHash: 'a'.repeat(64),
      expiresAt: Date.now() + OWNER_PREVIEW_TTL_MS,
    });

    expect((await ctx.app.request(`${SANDBOX_ORIGIN}/preview/${token}/frame`)).status).toBe(404);
  });

  it('refuses another account, even holding a validly signed token', async () => {
    // Account scoping is a predicate in the SQL, not a check after the read: the token supplies the
    // account id and the query never matches a row belonging to anyone else.
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const victim = await seed(ctx, 'victim@example.test');
    const attacker = await seed(ctx, 'attacker@example.test');
    const token = signOwnerPreviewToken(ctx.config.sessionSecret, {
      accountId: attacker.accountId,
      subject: 'artifact',
      subjectId: victim.htmlArtifactId,
      contentHash: 'a'.repeat(64),
      expiresAt: Date.now() + OWNER_PREVIEW_TTL_MS,
    });

    const response = await ctx.app.request(`${SANDBOX_ORIGIN}/preview/${token}/frame`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Owner preview body');
  });

  it("refuses another account's promoted template", async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const victim = await seed(ctx, 'template-victim@example.test');
    const attacker = await seed(ctx, 'template-attacker@example.test');
    ctx.db.sqlite
      .prepare(
        'INSERT INTO templates (id, account_id, slug, name, description, type, content, slots, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        'tpl_victimprivateexample',
        victim.accountId,
        'victim-private',
        'Victim Private',
        null,
        'html',
        '<h1>Private template</h1>',
        '[]',
        Date.now(),
        Date.now()
      );
    const token = signOwnerPreviewToken(ctx.config.sessionSecret, {
      accountId: attacker.accountId,
      subject: 'template',
      subjectId: 'tpl_victimprivateexample',
      contentHash: previewContentDigest('<h1>Private template</h1>'),
      expiresAt: Date.now() + OWNER_PREVIEW_TTL_MS,
    });

    const response = await ctx.app.request(`${SANDBOX_ORIGIN}/preview/${token}/frame`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Private template');
  });

  it('refuses a markdown artifact, which has no frame to serve', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { accountId, markdownArtifactId } = await seed(ctx);
    const token = signOwnerPreviewToken(ctx.config.sessionSecret, {
      accountId,
      subject: 'artifact',
      subjectId: markdownArtifactId,
      contentHash: 'a'.repeat(64),
      expiresAt: Date.now() + OWNER_PREVIEW_TTL_MS,
    });

    expect((await ctx.app.request(`${SANDBOX_ORIGIN}/preview/${token}/frame`)).status).toBe(404);
  });

  it('refuses an artifact the owner deleted since the page was rendered', async () => {
    const ctx = await makeContext(SANDBOX_ORIGIN);
    const { cookie, htmlArtifactId } = await seed(ctx);
    const src = previewSrc(await pageHtml(ctx, `/dashboard/artifacts/${htmlArtifactId}`, cookie));
    ctx.db.sqlite
      .prepare('UPDATE artifacts SET deleted_at = ? WHERE id = ?')
      .run(Date.now(), htmlArtifactId);

    const response = await ctx.app.request(src);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('Owner preview body');
  });
});
