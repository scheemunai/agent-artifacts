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

async function seed(
  ctx: AuthTestContext,
  views: number
): Promise<{ cookie: string; artifactId: string; email: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('append@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Append Bot');
  const created = await new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  }).upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'append-target',
    type: 'markdown',
    title: 'Append Target',
    content: '# Append',
    share: true,
  });
  ctx.db.sqlite
    .prepare('UPDATE shares SET view_count = ?, unique_viewer_count = ? WHERE id = ?')
    .run(views, views, created.share?.shareId);
  return {
    cookie: await login(ctx, account.email, 'password123'),
    artifactId: created.artifact.id,
    email: account.email,
  };
}

describe('V2-N8 · counts of one read as one', () => {
  it('does not say "1 views on this share · 1 unique viewers · 1 lifetime views"', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, 1);

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    expect(html).not.toContain('1 views');
    expect(html).not.toContain('1 unique viewers');
    expect(html).toContain('1 view on this share');
    expect(html).toContain('1 unique viewer');
    expect(html).toContain('1 lifetime view ');
  });

  it('still pluralises everything else', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, 4);

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('4 views on this share');
    expect(html).toContain('4 unique viewers');
    expect(html).toContain('4 lifetime views');
  });

  it('counts one view as one in the list row too', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, 1);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    expect(html).toContain('1 view');
    expect(html).not.toContain('1 views');
  });
});

describe('B-G3 · the account block is mounted once, at every width', () => {
  it('renders identity and Log out exactly once on every dashboard page', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId, email } = await seed(ctx, 1);

    for (const path of [
      '/dashboard',
      '/dashboard/bots',
      '/dashboard/templates',
      '/dashboard/settings',
      `/dashboard/artifacts/${artifactId}`,
    ]) {
      const html = await (await ctx.app.request(path, { headers: { Cookie: cookie } })).text();
      // The drawer copy and the main copy were both live at 375 with the drawer open. One
      // component rendered twice is still two things on the page.
      expect(html.split(`<span class="aa-hint">${email}</span>`).length - 1, path).toBe(1);
      expect(html.split('action="/dashboard/api/logout"').length - 1, path).toBe(1);
    }
  });

  it('leaves no empty drawer footer behind', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, 1);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    expect(html).not.toContain('<footer class="aa-drawer__footer"></footer>');
  });
});
