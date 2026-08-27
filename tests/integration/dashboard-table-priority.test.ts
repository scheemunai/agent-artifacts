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

/** The header cells of the first table in `html`, paired with their declared priority. */
function headerPriorities(html: string, tableId: string): Array<[string, string]> {
  const table = html.split(`<table class="aa-table" id="${tableId}">`)[1] ?? '';
  const head = table.split('</thead>')[0] ?? '';
  return (head.match(/<th\b[^>]*>[^<]*<\/th>/g) ?? []).map((cell) => {
    const label = cell.replace(/<[^>]*>/g, '');
    return [label, /data-aa-priority="secondary"/.test(cell) ? 'secondary' : 'primary'];
  });
}

async function seedAll(ctx: AuthTestContext): Promise<{ cookie: string; artifactId: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('tables@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Table Bot', 'Byline');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const created = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'table-target',
    type: 'markdown',
    title: 'Table Target',
    content: '# One',
    share: false,
  });
  await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'table-target',
    type: 'markdown',
    title: 'Table Target',
    content: '# Two',
    share: false,
    changeSummary: 'Second pass',
  });
  return {
    cookie: await login(ctx, account.email, 'password123'),
    artifactId: created.artifact.id,
  };
}

describe('B-T1 · tables drop their least-important columns instead of hiding controls', () => {
  it('the bots registry keeps Bot and Actions at 375 and demotes the rest', async () => {
    const ctx = await makeContext();
    const { cookie } = await seedAll(ctx);

    const html = await (
      await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('aa-table-scroll--priority');
    expect(headerPriorities(html, 'dashboard-bots')).toEqual([
      ['Bot', 'primary'],
      ['Key', 'secondary'],
      ['Last used', 'secondary'],
      ['Actions', 'primary'],
    ]);
  });

  it('version history keeps Version and Actions', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedAll(ctx);

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    expect(headerPriorities(html, 'artifact-versions')).toEqual([
      ['Version', 'primary'],
      ['Summary', 'secondary'],
      ['Actions', 'primary'],
    ]);
  });

  it('template tables keep Name and Actions, and each names its own scroll region', async () => {
    const ctx = await makeContext();
    const { cookie } = await seedAll(ctx);

    const html = await (
      await ctx.app.request('/dashboard/templates', { headers: { Cookie: cookie } })
    ).text();

    expect(headerPriorities(html, 'templates-starter')).toEqual([
      ['Name', 'primary'],
      ['Slug', 'secondary'],
      ['Slots', 'secondary'],
      ['Actions', 'primary'],
    ]);
    // Two tables on one page: their hints, and the aria-describedby pointing at them, must not
    // collide on a shared fallback id.
    expect(html).toContain('id="templates-starter-scroll-hint"');
    expect(html).toContain('aria-label="Starter templates"');
  });

  it('never marks an Actions column secondary anywhere in the dashboard', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedAll(ctx);

    for (const path of [
      '/dashboard/bots',
      '/dashboard/templates',
      `/dashboard/artifacts/${artifactId}`,
    ]) {
      const html = await (await ctx.app.request(path, { headers: { Cookie: cookie } })).text();
      expect(html, path).not.toMatch(/<th[^>]*data-aa-priority="secondary"[^>]*>Actions?</);
    }
  });
});

describe('B-M1 · an empty template table says its state, not its title twice', () => {
  it('renders the section heading once and offers a next step', async () => {
    const ctx = await makeContext();
    const { cookie } = await seedAll(ctx);

    const html = await (
      await ctx.app.request('/dashboard/templates', { headers: { Cookie: cookie } })
    ).text();

    expect(html.split('Your templates').length - 1).toBe(1);
    expect(html).toContain('No templates of your own yet.');
    expect(html).toContain('aa-empty__action');
  });
});
