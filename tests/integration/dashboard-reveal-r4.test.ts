import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { type AuthTestContext, createAuthTestContext, login } from './auth-test-utils.js';

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

async function seed(ctx: AuthTestContext): Promise<{ cookie: string; artifactId: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('reveal-r4@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Reveal Bot');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const created = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'reveal-target',
    type: 'markdown',
    title: 'Reveal Target',
    content: '# Reveal Target\n\nOne.',
    share: false,
  });
  await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'reveal-target',
    type: 'markdown',
    title: 'Reveal Target',
    content: '# Reveal Target\n\nTwo.',
    share: false,
    changeSummary: 'Second',
  });
  return {
    cookie: await login(ctx, account.email, 'password123'),
    artifactId: created.artifact.id,
  };
}

describe('B-C5 · a revealed panel is somewhere the browser actually goes', () => {
  it('points the Diff link at the panel it reveals, and makes that panel a focus target', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx);

    const listing = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();
    // A plain href reloaded the page at scrollY 0 with the diff card ~1250px down: the reader
    // pressed a control and nothing appeared to happen.
    expect(listing).toMatch(/href="[^"]*left=1&amp;right=2#version-diff"/);

    const revealed = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}?left=1&right=2`, {
        headers: { Cookie: cookie },
      })
    ).text();
    // The fragment only moves the viewport; making the target focusable is what moves the
    // reader's place in the document with it.
    expect(revealed).toMatch(/<section id="version-diff" tabindex="-1"/);
  });

  it('does the same for the template preview', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);
    const report = ctx.db.sqlite
      .prepare("SELECT id FROM templates WHERE slug = 'one-pager' AND account_id IS NULL")
      .get() as { id: string };

    const listing = await (
      await ctx.app.request('/dashboard/templates', { headers: { Cookie: cookie } })
    ).text();
    expect(listing).toMatch(/href="\/dashboard\/templates\?preview=[^"]*#template-preview"/);

    const revealed = await (
      await ctx.app.request(`/dashboard/templates?preview=${report.id}`, {
        headers: { Cookie: cookie },
      })
    ).text();
    expect(revealed).toMatch(/<section id="template-preview" tabindex="-1"/);
  });
});

describe('B-C6 · what can be opened can be closed', () => {
  it('gives the diff panel an exit that is not the address bar', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx);

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}?left=1&right=2`, {
        headers: { Cookie: cookie },
      })
    ).text();

    const panel = html.split('<section id="version-diff"')[1] ?? '';
    expect(panel).toContain('Close diff');
    // Back to the same artifact with the diff query dropped — URL surgery was the only way out.
    expect(panel).toContain(`href="/dashboard/artifacts/${artifactId}"`);
  });

  it('gives the template preview one too', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);
    const report = ctx.db.sqlite
      .prepare("SELECT id FROM templates WHERE slug = 'one-pager' AND account_id IS NULL")
      .get() as { id: string };

    const html = await (
      await ctx.app.request(`/dashboard/templates?preview=${report.id}`, {
        headers: { Cookie: cookie },
      })
    ).text();

    const panel = html.split('<section id="template-preview"')[1] ?? '';
    expect(panel).toContain('Close preview');
    expect(panel).toContain('href="/dashboard/templates"');
  });
});
