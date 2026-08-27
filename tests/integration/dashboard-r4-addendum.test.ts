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

async function seed(ctx: AuthTestContext, byline: string | null): Promise<{ cookie: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('addendum@example.test', 'password123');
  const { bot } = await auth.createBot(
    accountToCloudAccount(account),
    'QA Stage2 C Primary active bot',
    byline ?? undefined
  );
  await new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  }).upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'addendum-target',
    type: 'markdown',
    title: 'Addendum Target',
    content: '# Addendum',
    share: false,
  });
  return { cookie: await login(ctx, account.email, 'password123') };
}

describe('V3-N2 · a byline does not orphan its own closing bracket', () => {
  it('binds the last word of the parenthetical so "bot)" cannot land alone', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, 'QA Stage2 primary bot');

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    // Six rows wrapped as "…QA Stage2 primary / bot)" — a one-word-plus-bracket orphan under a
    // two-line title. A non-breaking space is the whole fix and needs no stylesheet.
    expect(html).toContain('(QA Stage2 primary bot)');
    expect(html).not.toContain('(QA Stage2 primary bot)');
  });

  it('leaves a single-word byline and a missing byline alone', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, 'Solo');

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    expect(html).toContain('(Solo)');
    expect(html).not.toContain(' Solo');
  });
});

describe('V3-N3 · the bots lede describes the product that shipped', () => {
  it('stops promising immediacy in the place the product learned not to be immediate', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, 'QA Stage2 primary bot');

    const html = await (
      await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } })
    ).text();

    // The sentence described the r1 always-open-form model and outlived it by two rounds.
    expect(html).not.toContain('immediate regenerate/revoke controls');
    expect(html).toContain('typed confirmation');
  });
});
