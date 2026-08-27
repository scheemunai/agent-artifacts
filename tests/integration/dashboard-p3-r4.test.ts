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

async function seed(ctx: AuthTestContext): Promise<{ cookie: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('p3-r4@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'P3 Bot');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  for (const slug of ['dash-one', 'dash-two']) {
    await artifacts.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug,
      type: 'markdown',
      title: slug,
      content: `# ${slug}`,
      share: false,
    });
  }
  return { cookie: await login(ctx, account.email, 'password123') };
}

describe('B-C7 · a filtered list that found things still says it is filtered', () => {
  it('offers a way out of a filter that is still returning results', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const filtered = await (
      await ctx.app.request('/dashboard?q=dash&type=markdown', { headers: { Cookie: cookie } })
    ).text();

    // The zero-result case got a Clear in round 3. A filter that still matches things is the
    // case where the reader is most likely to forget one is applied at all.
    expect(filtered).toContain('Clear filters');
    expect(filtered).toContain('Filtered by');
    expect(filtered).toContain('q: dash');
    expect(filtered).toContain('type: markdown');
  });

  it('says nothing about filters when none are applied', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const plain = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    expect(plain).not.toContain('Filtered by');
    expect(plain).not.toContain('Clear filters');
  });
});

describe('B-B6 · a slug looks like a slug everywhere', () => {
  it('renders the template preview slug as code, as every table does', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);
    const report = ctx.db.sqlite
      .prepare("SELECT id, slug FROM templates WHERE slug = 'report' AND account_id IS NULL")
      .get() as { id: string; slug: string };

    const html = await (
      await ctx.app.request(`/dashboard/templates?preview=${report.id}`, {
        headers: { Cookie: cookie },
      })
    ).text();

    const panel = html.split('<section id="template-preview"')[1] ?? '';
    expect(panel).toContain('<code>report</code>');
    expect(panel).not.toMatch(/<span class="aa-badge[^"]*">report</);
  });
});
