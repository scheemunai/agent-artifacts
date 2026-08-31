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

/**
 * Every artifact card in the page, split apart.
 *
 * Matched on the base class with the modifiers left open, because the modifier list is a
 * COMPOSITION: `--linked` when the card has an href, `--with-actions` when it has an action slot,
 * and more as the pattern grows. Pinning the exact string made these tests fail the day a row
 * gained an action — not because the row broke, but because the assertion had memorised today's
 * modifier set. The class the assertions actually care about is the first one.
 */
function cards(html: string): string[] {
  return html.split(/<li class="aa-dashboard-card\b[^"]*">/).slice(1);
}

/** The markup between the artifact card list and the end of the list. */
function listMarkup(html: string): string {
  return html.split('<ul class="aa-dashboard-card-list" aria-label="Artifacts">')[1] ?? '';
}

describe('B-N1 / B-N2 / B-N3 · the artifact list adopts the dashboard card list', () => {
  it('renders one dashboard card per artifact inside one card list', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, ['Alpha report', 'Beta report', 'Gamma report']);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('<ul class="aa-dashboard-card-list" aria-label="Artifacts">');
    expect(cards(html)).toHaveLength(3);
    // Still linked — the modifier is not asserted by the split above, so it is asserted here.
    for (const card of cards(html)) {
      expect(card).toContain('class="aa-dashboard-card__link"');
    }
    expect(listMarkup(html)).not.toContain('aa-list-row');
  });

  it('puts the title in the card as the stretched link, so the card is the target', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, ['Alpha report']);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toMatch(
      /<h3 class="aa-dashboard-card__title">\s*<a class="aa-dashboard-card__link" href="\/dashboard\/artifacts\/[^"]+">/
    );
    expect(html).toContain('aa-dashboard-card__meta');
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
    const firstCard = cards(list)[0] ?? '';
    expect(firstCard.indexOf('<code>')).toBeLessThan(firstCard.indexOf('aa-dashboard-card__meta'));
  });
});

describe("the pattern's own constraint, held where it is consumed", () => {
  it('keeps every row control in the one layer the overlay does not cover', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx, ['Alpha report', 'Beta report']);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    /*
     * THIS TEST USED TO SAY "EXACTLY ONE TARGET PER ROW", AND IT DID ITS JOB: adding the Open
     * control failed it, which is precisely what its author asked for — "the next person to add a
     * Delete button to this row should be told by a test, not by a bug report." This is that
     * person, and the reply is that the count was a proxy for the real rule.
     *
     * The real rule is about LAYERS, not arithmetic. `--linked` stretches the title's `::after`
     * across the whole card at `z-index: auto`, so anything in ordinary row content is buried under
     * it and unclickable. `.aa-dashboard-card__actions` is `position: relative; z-index: 1` — the
     * primitive's author built exactly one region that paints ABOVE the overlay, which is what
     * makes a second target possible at all. So the constraint that actually protects a reader is:
     * the stretched link may be the only control outside the actions slot.
     *
     * A count would now pass a row with a Delete button dropped into the meta line and no Open
     * control, which is the unclickable case the original was written to prevent. This fails it.
     *
     * The layering itself is a rendered property that no string can settle — asserted for real in
     * tests/e2e/smoke.spec.ts, which asks the browser which element receives the press.
     */
    const rows = cards(html);
    expect(rows).toHaveLength(2);
    for (const card of rows) {
      const body = card.split('</li>')[0] ?? card;
      // The actions slot is the last child of the last child, so everything from its marker on is
      // inside it — and everything before it is in the buried layer.
      const [buried = '', elevated = ''] = body.split('<div class="aa-dashboard-card__actions">');
      const controls = (fragment: string) =>
        fragment.match(/<(?:a|button|input|select|textarea)\b/g) ?? [];

      expect(controls(buried)).toHaveLength(1);
      expect(buried).toContain('class="aa-dashboard-card__link"');
      // And the row does carry its second target, in the layer that can receive a click.
      expect(elevated, 'the row has no actions slot').not.toBe('');
      expect(controls(elevated).length).toBeGreaterThan(0);
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
