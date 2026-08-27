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

async function seed(ctx: AuthTestContext, titles: string[]): Promise<{ cookie: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('rows@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Row Bot', 'Row byline');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  for (const [index, title] of titles.entries()) {
    await artifacts.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: `row-${index}`,
      type: 'markdown',
      title,
      content: `# ${title}`,
      share: index === 0,
    });
  }
  return { cookie: await login(ctx, account.email, 'password123') };
}

/** The markup between `<div class="aa-list">` and the end of the list. */
function listMarkup(html: string): string {
  return html.split('<div class="aa-list">')[1] ?? '';
}

describe('B-N1 / B-N2 / B-N3 · the artifact list adopts the published row', () => {
  it('renders one aa-list-row per artifact inside one aa-list', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, ['Alpha report', 'Beta report', 'Gamma report']);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('<div class="aa-list">');
    expect(html.match(/class="aa-list-row"/g) ?? []).toHaveLength(3);
    // A stack of cards is what the guide's aligned-row pattern replaces; each row was its own
    // bordered box with nothing lining up between them.
    expect(listMarkup(html)).not.toContain('aa-card');
  });

  it('puts the title in the title cell as the stretched link, so the whole row is the target', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, ['Alpha report']);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toMatch(
      /<span class="aa-list-row__title">\s*<a class="aa-list-row__link" href="\/dashboard\/artifacts\/[^"]+">/
    );
    // Only the title text was interactive before; the rest of a clickable-looking row was inert.
    expect(html).toContain('aa-list-row__meta');
  });

  it('promotes the slug out of the meta line, where it was the differentiator nobody could see', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, ['Same title', 'Same title']);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    // Two artifacts can share a title; the slug is what tells them apart, and it sat at 14px grey
    // at the end of a meta line while the title carried all the emphasis.
    const list = listMarkup(html);
    expect(list).toContain('<code>row-0</code>');
    expect(list).toContain('<code>row-1</code>');
    const firstRow = list.split('class="aa-list-row"')[1] ?? '';
    expect(firstRow.indexOf('<code>')).toBeLessThan(firstRow.indexOf('aa-list-row__meta'));
  });
});

describe("the pattern's own constraint, held where it is consumed", () => {
  it('gives every row exactly one target, because the overlay covers the others', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, ['Alpha report', 'Beta report']);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    // The foundation's constraint, stated by its author: the stretched-link overlay paints above
    // ordinary row content, so a second control in a row is unclickable unless it is positioned
    // above the overlay — and a row that needs several targets wants a different pattern, not a
    // workaround. Asserting it here rather than trusting a reading of today's markup: the next
    // person to add a Delete button to this row should be told by a test, not by a bug report.
    const rows = html.split('<div class="aa-list-row">').slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const body = row.split('</div>')[0] ?? row;
      const controls = body.match(/<(?:a|button|input|select|textarea)\b/g) ?? [];
      expect(controls).toHaveLength(1);
      expect(body).toContain('class="aa-list-row__link"');
    }
  });
});

describe('B-D3 · the danger zone looks like one', () => {
  it('gives the delete-account card the danger tone the primitive now publishes', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, ['Alpha report']);

    const html = await (
      await ctx.app.request('/dashboard/settings', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('aa-card--danger');
    // Only the one card: Email and Password are not danger zones.
    expect(html.match(/aa-card--danger/g) ?? []).toHaveLength(1);
    const dangerCard = html.split('aa-card--danger')[1] ?? '';
    expect(dangerCard).toContain('Delete account');
  });
});
