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

/**
 * Everything the `EmptyState` renders, including whatever was put in its action slot.
 *
 * Bounded at the first `</section>`: with the slot empty of content that closes the empty state
 * itself, and with a `CopyBlock` in it that boundary is the copy block's own close — either way
 * the window contains the action slot, which is what is being asserted about.
 */
function emptyStateMarkup(html: string): string {
  return (html.split('<section class="aa-empty"')[1] ?? '').split('</section>')[0] ?? '';
}

async function signIn(
  ctx: AuthTestContext,
  options: { bot?: boolean; artifact?: boolean } = {}
): Promise<string> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('empty@example.test', 'password123');
  if (options.bot || options.artifact) {
    const { bot } = await auth.createBot(accountToCloudAccount(account), 'Empty Bot');
    if (options.artifact) {
      await new ArtifactService({
        db: ctx.db,
        extension: createDefaultCloudModule(ctx.config),
        baseUrl: ctx.config.baseUrl,
      }).upsertArtifact({
        account: accountToCloudAccount(account),
        bot: { id: bot.id, name: bot.name, byline: bot.byline },
        slug: 'present',
        type: 'markdown',
        title: 'Present Artifact',
        content: '# Present',
        share: false,
      });
    }
  }
  return login(ctx, account.email, 'password123');
}

describe('B-A1 · no filter form for a list that has nothing to filter', () => {
  it('suppresses the filter card on a first-run account', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx);

    const html = await (
      await ctx.app.request('/dashboard/artifacts', { headers: { Cookie: cookie } })
    ).text();

    // At 375 this three-control form filled the whole first viewport and pushed the one piece of
    // first-run guidance below the fold — for a list with nothing in it.
    expect(html).not.toContain('aa-dashboard-filter-bar');
    expect(html).toContain('No artifacts yet');
  });

  it('keeps the filter bar once there is something to filter', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx, { artifact: true });

    const html = await (
      await ctx.app.request('/dashboard/artifacts', { headers: { Cookie: cookie } })
    ).text();
    expect(html).toContain('aa-dashboard-filter-bar');
  });

  it('keeps the filter bar when a filter is what emptied the list, and says so', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx, { artifact: true });

    const html = await (
      await ctx.app.request('/dashboard/artifacts?q=nothing-matches-this', {
        headers: { Cookie: cookie },
      })
    ).text();

    // Removing the controls here would leave no way back to the full list.
    expect(html).toContain('aa-dashboard-filter-bar');
    expect(html).toContain('No artifacts match those filters.');
    expect(html).not.toContain('No artifacts yet');
  });
});

describe('B-A3 · the empty state acts, the install prompt is content', () => {
  it('keeps a ~350px CopyBlock out of the action slot', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx, { bot: true });

    const html = await (
      await ctx.app.request('/dashboard/artifacts', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('Install prompt');
    // The action slot is for a single next step. Used as a content region it made the "empty"
    // state the largest object on the page, white card inside dashed card inside grey slab.
    expect(emptyStateMarkup(html)).not.toContain('aa-copy');
    expect(html.indexOf('aa-empty__action')).toBeLessThan(html.indexOf('aa-copy'));
  });
});

describe('B-A4 · the bots empty state points at what to do next', () => {
  it('leads the page and offers the first step instead of referring backwards', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx);

    const html = await (
      await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('Register your first bot');
    expect(html).toContain('href="/dashboard/bots?new_bot=1#new-bot"');
    expect(html).toContain('<details class="aa-dashboard-disclosure" id="new-bot"');
    expect(html).not.toContain('<details class="aa-dashboard-disclosure" id="new-bot" open');

    const opened = await (
      await ctx.app.request('/dashboard/bots?new_bot=1', { headers: { Cookie: cookie } })
    ).text();
    expect(opened).toContain('<details class="aa-dashboard-disclosure" id="new-bot" open');
  });

  it('drops the empty state once a bot exists', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx, { bot: true });

    const html = await (
      await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } })
    ).text();
    expect(html).not.toContain('Register your first bot');
    expect(html).toContain('aa-dashboard-card-list');
    expect(html).toContain('Empty Bot');
  });
});
