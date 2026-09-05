import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { promoteArtifactToTemplate } from '../../src/services/templates.js';
import { type AuthTestContext, createAuthTestContext, login } from './auth-test-utils.js';

/**
 * The templates listing is a gallery, and a gallery has to survive its own edge cases.
 *
 * Three of them are load-bearing and none is visible from a single card: a built-in shows the
 * picture it ships with, a template you promoted shows a designed stand-in rather than a broken
 * image, and neither shows `{{slot}}` pills — the field-form framing the page was rebuilt to stop
 * making. The fourth is the preview: an HTML template's example is only visible if it is actually
 * framed, and that frame is a route with an owner check, a type check and a CSP of its own.
 */
let contexts: AuthTestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.map((ctx) => ctx.cleanup()));
  contexts = [];
});

async function makeContext(): Promise<AuthTestContext> {
  const ctx = await createAuthTestContext();
  contexts.push(ctx);
  return ctx;
}

interface Seeded {
  cookie: string;
  /** A built-in HTML template: has a thumbnail, and its preview is framed. */
  digestId: string;
  /** A built-in markdown template: has a thumbnail, and its preview is server-rendered. */
  reportId: string;
  /** Promoted from the account's own artifact, so it has no thumbnail at all. */
  promotedId: string;
}

async function seed(ctx: AuthTestContext): Promise<Seeded> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('gallery@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Gallery Bot', 'Byline');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const created = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'my-own-page',
    type: 'html',
    title: 'My Own Page',
    content: '<h1>Mine</h1><p>Body.</p>',
    share: false,
  });
  const promoted = await promoteArtifactToTemplate({
    db: ctx.db,
    accountId: account.id,
    artifactId: created.artifact.id,
    name: 'My Own Page',
    slug: 'my-own-page-template',
    description: 'Promoted from my own artifact.',
  });
  const builtIn = (slug: string): string =>
    (
      ctx.db.sqlite
        .prepare('SELECT id FROM templates WHERE slug = ? AND account_id IS NULL')
        .get(slug) as { id: string }
    ).id;

  return {
    cookie: await login(ctx, account.email, 'password123'),
    digestId: builtIn('daily-digest'),
    reportId: builtIn('report'),
    promotedId: promoted.id,
  };
}

/** The card `<li>` whose preview link points at `templateId`. */
function cardFor(html: string, templateId: string): string {
  const cards = html.split('<li class="aa-template-card">').slice(1);
  const card = cards.find((entry) => entry.includes(`preview=${templateId}`));
  expect(card, `no template card links to ${templateId}`).toBeDefined();
  return (card as string).split('</li>')[0] as string;
}

describe('the templates listing shows the example instead of describing its fields', () => {
  it('leads each starter card with the thumbnail the template ships', async () => {
    const ctx = await makeContext();
    const { cookie, digestId } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard/templates', { headers: { Cookie: cookie } })
    ).text();

    // A grid, and still the dashboard's card list: same reset, same square corners.
    expect(html).toContain('class="aa-dashboard-card-list aa-template-grid"');
    const card = cardFor(html, digestId);
    expect(card).toContain('src="/assets/template-thumbs/daily-digest.png"');
    // Decorative: the accessible name of the one link in the card is the template's name.
    expect(card).toContain('alt=""');
    expect(card).toContain('>Daily digest</a>');
    // Lowercase, as the artifact badges and the preview panel spell it.
    expect(card).toContain('>html</span>');
    expect(card).toContain('>starter</span>');
  });

  it('gives a template with no thumbnail a designed cover rather than a broken image', async () => {
    const ctx = await makeContext();
    const { cookie, promotedId } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard/templates', { headers: { Cookie: cookie } })
    ).text();

    const card = cardFor(html, promotedId);
    const cover = card.split('</div>')[0] as string;
    expect(cover).toContain('aa-template-card__placeholder');
    expect(card, 'a null thumbnail must never reach an img element').not.toContain('<img');
    // The mark and nothing else: the body below already prints the name and the type badge.
    expect(cover).toContain('class="aa-mark"');
    expect(cover).not.toContain('My Own Page');
    expect(card).toContain('>My Own Page</a>');
    expect(card).toContain('>yours</span>');
  });

  it('names no slot anywhere in the listing', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard/templates', { headers: { Cookie: cookie } })
    ).text();
    const listing = html.split('<section class="aa-dashboard-group"')[1] ?? '';

    expect(listing, 'the listing is back to advertising fields').not.toContain('{{');
    expect(listing).not.toContain('no slots');
  });
});

describe('the template preview shows the example, not only its source', () => {
  it('frames an HTML template and keeps the source block', async () => {
    const ctx = await makeContext();
    const { cookie, digestId } = await seed(ctx);

    const html = await (
      await ctx.app.request(`/dashboard/templates?preview=${digestId}`, {
        headers: { Cookie: cookie },
      })
    ).text();
    const panel = html.split('<section id="template-preview"')[1] ?? '';

    // The URL is the token one the panel was handed, not a path built from the template id. It is
    // absolute because on cloud it points at the sandbox host, which is the only origin the
    // dashboard's own CSP will frame.
    expect(panel).toMatch(/src="[^"]*\/preview\/[A-Za-z0-9_-]+\.[a-f0-9]{64}\/frame"/);
    expect(panel).toContain('sandbox="allow-scripts"');
    expect(panel).toContain('Template source');
  });

  it('keeps the server-rendered preview for a markdown template', async () => {
    const ctx = await makeContext();
    const { cookie, reportId } = await seed(ctx);

    const html = await (
      await ctx.app.request(`/dashboard/templates?preview=${reportId}`, {
        headers: { Cookie: cookie },
      })
    ).text();
    const panel = html.split('<section id="template-preview"')[1] ?? '';

    expect(panel).toContain('data-aa-dashboard-template-preview="markdown"');
    expect(panel).not.toContain('/frame"');
    // Markdown templates do declare slots, and the preview is where naming them helps.
    expect(panel).toContain('Slots your agent can fill');
  });
});

describe('the template frame is gated the way the artifact frame is', () => {
  it('serves an HTML template sandboxed, to whoever holds the preview token', async () => {
    const ctx = await makeContext();
    const { cookie, digestId } = await seed(ctx);
    const panel = (
      await (
        await ctx.app.request(`/dashboard/templates?preview=${digestId}`, {
          headers: { Cookie: cookie },
        })
      ).text()
    ).split('<section id="template-preview"')[1] as string;
    const src = panel.match(/\ssrc="([^"]*\/preview\/[^"]*)"/)?.[1] as string;
    expect(src, 'the panel rendered no preview iframe').toBeDefined();

    const framed = await ctx.app.request(src);
    expect(framed.status).toBe(200);
    expect(framed.headers.get('content-type')).toContain('text/html');
    expect(framed.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
    expect(framed.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    // Raw, exactly as the artifact frame serves an artifact: a template promoted from an artifact
    // must not preview differently here than it does on the page it was promoted from.
    const stored = (
      ctx.db.sqlite.prepare('SELECT content FROM templates WHERE id = ?').get(digestId) as {
        content: string;
      }
    ).content;
    expect(await framed.text()).toBe(stored);

    // The session is no longer what authorises this, and that is the fix rather than a regression:
    // on cloud the frame is served by a host the session cookie never reaches. What replaces it is
    // the five-minute, account-scoped token in the URL — exercised for expiry, forgery and
    // cross-account reads in tests/integration/owner-preview-frame.test.ts.
    const withoutSession = await ctx.app.request(src);
    expect(withoutSession.status).toBe(200);
    const withoutToken = await ctx.app.request('/preview/not-a-token/frame', {
      headers: { Cookie: cookie },
    });
    expect(withoutToken.status, 'a session was accepted in place of a token').toBe(404);
  });

  it('has nothing to frame for a markdown template', async () => {
    const ctx = await makeContext();
    const { cookie, reportId } = await seed(ctx);

    const html = await (
      await ctx.app.request(`/dashboard/templates?preview=${reportId}`, {
        headers: { Cookie: cookie },
      })
    ).text();
    const panel = html.split('<section id="template-preview"')[1] ?? '';

    // No frame at all rather than a frame that 404s: markdown previews are rendered inline.
    expect(panel).not.toContain('/preview/');
    expect(panel).not.toContain('<iframe');
  });
});
