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

async function seed(ctx: AuthTestContext): Promise<{ cookie: string; email: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('craft@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Craft Bot', 'Craft byline');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const created = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'craft-target',
    type: 'markdown',
    title: 'Craft Target',
    content: '# Craft',
    share: true,
  });
  // Lifetime views aggregate over shares, so the count has to be set where it is counted.
  ctx.db.sqlite
    .prepare('UPDATE shares SET view_count = ? WHERE id = ?')
    .run(50_000, created.share?.shareId);
  return { cookie: await login(ctx, account.email, 'password123'), email: account.email };
}

describe('B-B1 · status tones stop being spent on taxonomy', () => {
  it('renders artifact type as a neutral tag, never success or info', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    // Green means "good" and blue means "informational"; neither means "markdown". Spending them
    // on a type left no tone available for real state.
    expect(html).not.toMatch(/<span class="aa-badge aa-badge--success">\s*md\s*</);
    expect(html).not.toMatch(/<span class="aa-badge aa-badge--info">\s*html\s*</);
    expect(html).toMatch(/<span class="aa-badge aa-badge--neutral">\s*md\s*</);
  });

  it('uses the same neutral treatment in the template preview panel', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);
    const report = ctx.db.sqlite
      .prepare("SELECT id FROM templates WHERE slug = 'report' AND account_id IS NULL")
      .get() as { id: string };

    const html = await (
      await ctx.app.request(`/dashboard/templates?preview=${report.id}`, {
        headers: { Cookie: cookie },
      })
    ).text();
    expect(html).not.toMatch(/aa-badge--success">\s*markdown/);
  });
});

describe('B-N5 / B-N6 · numbers and bylines read like a product', () => {
  it('groups large view counts', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    expect(html).toContain('50,000 views');
    expect(html).not.toContain('50000 views');
  });

  it('stops joining a bot name to its byline with the separator used between unrelated fields', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);
    const artifact = ctx.db.sqlite.prepare('SELECT id FROM artifacts LIMIT 1').get() as {
      id: string;
    };

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifact.id}`, { headers: { Cookie: cookie } })
    ).text();
    // "by Craft Bot · Craft byline · updated" read as two bots separated by a field delimiter.
    expect(html).not.toContain('by Craft Bot · Craft byline');
    expect(html).toContain('Craft Bot (Craft byline)');
  });
});

describe('B-N4 · the list footer is one component in both of its states', () => {
  it('renders the end of the list through Pagination rather than a bare Badge', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    expect(html).toContain('aa-pagination');
    expect(html).not.toMatch(/<span class="aa-badge[^"]*">End of list<\/span>/);
  });
});

describe('V2-N5 · the phone keeps the datum an operator checks before revoking', () => {
  it('carries key tail and last-used in the bot cell, so no column has to be dropped', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } })
    ).text();

    const table = html.split('<table class="aa-table" id="dashboard-bots">')[1] ?? '';
    const head = table.split('</thead>')[0] ?? '';
    const headers = (head.match(/<th\b[^>]*>[^<]*<\/th>/g) ?? []).map((cell) =>
      cell.replace(/<[^>]*>/g, '')
    );
    // Two columns, so nothing needs demoting and nothing goes off-screen at 375.
    expect(headers).toEqual(['Bot', 'Actions']);
    expect(head).not.toContain('data-aa-priority="secondary"');
    // The data that used to be dropped is now in the cell that always survives.
    expect(table).toContain('aa_bot_…');
    expect(table).toContain('never used');
  });
});

describe('B-F2 / B-F4 · the settings page stops misleading and stops leaking status codes', () => {
  it('shows the current email as text and leaves the new-email field empty', async () => {
    const ctx = await makeContext();
    const { cookie, email } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard/settings', { headers: { Cookie: cookie } })
    ).text();

    // Prefilled with the current address, Update could be pressed with no change at all.
    expect(html).not.toMatch(new RegExp(`<input[^>]*id="new_email"[^>]*value="${email}"`));
    expect(html).toMatch(/<input[^>]*id="new_email"[^>]*value=""/);
    expect(html).toContain(`Currently ${email}`);
  });

  it('describes deletion in user language rather than HTTP status codes', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard/settings', { headers: { Cookie: cookie } })
    ).text();
    expect(html).not.toContain('404, not 410');
    // A bare '410' would match asset hashes and generated ids; the claim is about the sentence.
    expect(html).not.toMatch(/return 404|not 410/);
    expect(html).toContain('read as missing');
  });
});

describe('B-F3 · password managers can tell the fields apart', () => {
  it('labels current and new password fields with autocomplete tokens', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard/settings', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toMatch(/<input[^>]*id="current_password"[^>]*autocomplete="current-password"/);
    expect(html).toMatch(/<input[^>]*id="new_password"[^>]*autocomplete="new-password"/);
    expect(html).toMatch(/<input[^>]*id="confirm_password"[^>]*autocomplete="new-password"/);
  });
});
