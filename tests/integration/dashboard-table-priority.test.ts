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
  it('the bots registry uses cards, so actions are never hidden in a table', async () => {
    const ctx = await makeContext();
    const { cookie } = await seedAll(ctx);

    const html = await (
      await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } })
    ).text();

    expect(html).not.toContain('id="dashboard-bots"');
    expect(html).toContain('aa-dashboard-card-list');
    expect(html).toContain('Regenerate key');
    expect(html).toContain('Revoke key');
  });

  /**
   * This assertion was inverted once, and putting it back is the point of the test.
   *
   * `83d3fe6` deleted `columnPriority` from the version-history table with no stated reason, and
   * `8dce0a2` — a commit about HTML templates — then flipped this expectation from `toContain` to
   * `not.toContain` so the suite went green again. What that pair shipped is the exact defect
   * `178f849` fixed: `.aa-table` forces a 42rem minimum, so with priority off the table scrolls and
   * the Actions column leaves the viewport. Measured in Chromium at 375px: the Diff control ended
   * at 532px — 157px past the right edge, behind a scroll region nothing signposts. Diff and
   * Restore were unreachable on a phone.
   *
   * The flipped version was incoherent on its own terms as well: it kept asserting that Summary is
   * declared `secondary` while asserting that the machinery which acts on that declaration is
   * switched off. A column marked demotable that can never be demoted is markup describing a
   * behaviour the page does not have.
   *
   * So the trade is asserted rather than the markup: below 480px the Summary column is dropped and
   * the controls stay on screen. The e2e suite measures the other half — `expectActionsColumnReachable`
   * in `smoke.spec.ts` checks where Diff actually lands, at every viewport edge.
   */
  it('version history drops Summary rather than pushing Diff and Restore off-screen', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedAll(ctx);

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('<table class="aa-table" id="artifact-versions">');
    expect(
      html,
      'the version table forces its 42rem minimum again, which puts Diff and Restore off-screen at 375'
    ).toContain('aa-table-scroll--priority');
    expect(headerPriorities(html, 'artifact-versions')).toEqual([
      ['Version', 'primary'],
      ['Summary', 'secondary'],
      ['Actions', 'primary'],
    ]);
  });

  it('template lists use cards instead of table scroll regions', async () => {
    const ctx = await makeContext();
    const { cookie } = await seedAll(ctx);

    const html = await (
      await ctx.app.request('/dashboard/templates', { headers: { Cookie: cookie } })
    ).text();

    expect(html).not.toContain('id="templates-starter"');
    expect(html).not.toContain('id="templates-starter-scroll-hint"');
    // The starters are grouped by category now — the same six the public gallery and
    // `?category=` use — so there is no single "Starter templates" list to name any more. What this
    // assertion is actually about is unchanged: a labelled CARD list rather than a scroll region.
    expect(html).toContain('aria-label="Meetings &amp; recaps"');
    expect(html).toContain('aa-dashboard-card-list');
    expect(html).toContain('Preview');
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
