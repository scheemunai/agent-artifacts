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

interface Seeded {
  cookie: string;
  protectedId: string;
  revokedId: string;
  neverSharedId: string;
}

async function seed(ctx: AuthTestContext): Promise<Seeded> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('signal-r4@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Signal Bot');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const make = async (slug: string, share: boolean) =>
    artifacts.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug,
      type: 'markdown',
      title: slug,
      content: `# ${slug}`,
      share,
    });

  const guarded = await make('guarded', true);
  ctx.db.sqlite
    .prepare("UPDATE shares SET password_hash = 'argon2-placeholder' WHERE id = ?")
    .run(guarded.share?.shareId);

  const revoked = await make('revoked-one', true);
  await artifacts.revokeShare({
    account: accountToCloudAccount(account),
    idOrSlug: revoked.artifact.id,
  });

  const never = await make('never-shared', false);

  return {
    cookie: await login(ctx, account.email, 'password123'),
    protectedId: guarded.artifact.id,
    revokedId: revoked.artifact.id,
    neverSharedId: never.artifact.id,
  };
}

function rowFor(html: string, slug: string): string {
  return (
    html
      .split('<div class="aa-list-row">')
      .slice(1)
      .find((row) => row.includes(`<code>${slug}</code>`)) ?? ''
  );
}

describe('B-B2 · one share state, one rendering, wherever it appears', () => {
  it('says the same thing on the detail header as in the list row', async () => {
    const ctx = await makeContext();
    const { cookie, protectedId } = await seed(ctx);

    const list = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    const detail = await (
      await ctx.app.request(`/dashboard/artifacts/${protectedId}`, { headers: { Cookie: cookie } })
    ).text();

    // The list said "Shared · password" and the detail header of the SAME artifact said only
    // "Shared" — the discriminator lived 500px further down, in the panel.
    expect(rowFor(list, 'guarded')).toContain('Shared · password');
    const header = detail.split('<p class="aa-section-note">')[0] ?? '';
    expect(header).toContain('Shared · password');
  });
});

describe('B-B4 · a revoked link is not the same thing as never having shared', () => {
  it('distinguishes them in the list', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    // Both rendered a neutral "private" pill, so an artifact whose public link was pulled looked
    // exactly like one that had never left the account. previousShareCount already knew.
    expect(rowFor(html, 'revoked-one')).toContain('Link revoked');
    expect(rowFor(html, 'never-shared')).toContain('private');
    expect(rowFor(html, 'never-shared')).not.toContain('Link revoked');
  });
});

describe('V3-N1 · the end-of-list count says which count it is', () => {
  it('does not claim a page total is the account total', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const firstPage = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    // No cursor and no next page: this really is everything, so the plain claim is true.
    expect(firstPage).toContain('3 artifacts · end of list');

    // On a later page the same string meant something else entirely — "8 artifacts · end of
    // list" on a 28-artifact account read as "this account has 8".
    // This used to fake "a later page" with the string 'notarealcursor', which worked only because
    // an undecodable cursor was silently swallowed. B-C9 made that state impossible — it now
    // redirects — so the fixture has to be a cursor that really decodes. The old version was
    // asserting real behaviour through a door the product has since, correctly, shut.
    const cursor = Buffer.from(
      JSON.stringify({ updatedAt: Date.now() + 60_000, id: 'art_beforeeverything' })
    ).toString('base64url');
    const later = await (
      await ctx.app.request(`/dashboard?cursor=${cursor}`, { headers: { Cookie: cookie } })
    ).text();
    expect(later).not.toContain('3 artifacts · end of list');
    expect(later).toContain('3 on this page · end of list');
  });

  it('does not claim the end of the list while a next page exists', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('paged-r4@example.test', 'password123');
    const { bot } = await auth.createBot(accountToCloudAccount(account), 'Paged Bot');
    const artifacts = new ArtifactService({
      db: ctx.db,
      extension: createDefaultCloudModule(ctx.config),
      baseUrl: ctx.config.baseUrl,
    });
    // One more than the page size, so the first page has a next cursor.
    for (let index = 0; index < 21; index += 1) {
      await artifacts.upsertArtifact({
        account: accountToCloudAccount(account),
        bot: { id: bot.id, name: bot.name, byline: bot.byline },
        slug: `paged-${index}`,
        type: 'markdown',
        title: `Paged ${index}`,
        content: `# Paged ${index}`,
        share: false,
      });
    }
    const cookie = await login(ctx, account.email, 'password123');

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    // The third branch of the summary, and the one a large account sees on every page but the
    // last. The other two were pinned when V3-N1 landed and this one was not, which left the
    // most-seen state of the three free to start claiming "20 artifacts · end of list" — the
    // exact defect V3-N1 fixed — without failing anything.
    expect(html).toContain('20 shown so far');
    expect(html).not.toContain('end of list');
  });
});
