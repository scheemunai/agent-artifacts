import { readFileSync } from 'node:fs';
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

async function makeContext(retentionDays: number | null = null): Promise<AuthTestContext> {
  const ctx = await createAuthTestContext(
    {},
    retentionDays === null
      ? {}
      : {
          cloudModule: {
            resolvePlan: async () => ({
              id: 'test',
              name: 'Test',
              showFooter: false,
              limits: { maxBots: null, maxArtifacts: null },
              artifact_retention_days: retentionDays,
            }),
            checkQuota: async () => ({ allow: true }),
          },
        }
  );
  contexts.push(ctx);
  return ctx;
}

async function seed(
  ctx: AuthTestContext,
  options: {
    type?: 'markdown' | 'html';
    versions?: number;
    share?: boolean;
    content?: string;
  } = {}
): Promise<{ cookie: string; artifactId: string; email: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('sweep@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Sweep Bot');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const type = options.type ?? 'markdown';
  const created = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'sweep-target',
    type,
    title: 'Sweep Target',
    content: options.content ?? (type === 'markdown' ? '# One' : '<h1>One</h1>'),
  });
  // Creation is private now, so `share: true` in these fixtures means "and publish it" — the same
  // second call a real owner makes from the share panel.
  if (options.share) {
    await artifacts.createShare({
      account: accountToCloudAccount(account),
      idOrSlug: created.artifact.id,
    });
  }
  for (let index = 1; index < (options.versions ?? 1); index += 1) {
    await artifacts.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'sweep-target',
      type,
      title: 'Sweep Target',
      content: type === 'markdown' ? `# Pass ${index}` : `<h1>Pass ${index}</h1>`,
      share: false,
      changeSummary: `Pass ${index}`,
    });
  }
  return {
    cookie: await login(ctx, account.email, 'password123'),
    artifactId: created.artifact.id,
    email: account.email,
  };
}

describe('B-B3 · an expiry badge in the right tense', () => {
  it('reads expired once the moment has passed, never "expires in 0d"', async () => {
    const ctx = await makeContext(30);
    const { cookie, artifactId } = await seed(ctx);
    const longAgo = Date.now() - 90 * 86_400_000;
    ctx.db.sqlite
      .prepare('UPDATE artifacts SET created_at = ?, updated_at = ? WHERE id = ?')
      .run(longAgo, longAgo, artifactId);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    // The countdown clamped at zero but kept the future tense, so a gone artifact announced
    // itself as one about to go.
    expect(html).not.toContain('expires in 0d');
    expect(html).toContain('>expired<');
  });

  it('says today rather than counting down to a day it has already reached', async () => {
    const ctx = await makeContext(30);
    const { cookie, artifactId } = await seed(ctx);
    const nearlyGone = Date.now() - 30 * 86_400_000 + 6 * 3_600_000;
    ctx.db.sqlite
      .prepare('UPDATE artifacts SET created_at = ?, updated_at = ? WHERE id = ?')
      .run(nearlyGone, nearlyGone, artifactId);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();
    expect(html).toContain('expires today');
  });
});

describe('B-C1 / B-C4 · no control that cannot do anything', () => {
  it('drops the Share button that resolved to a panel already on screen', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { share: true });

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    expect(html).not.toContain('href="#share-panel"');
    expect(html).toContain('Share panel');
    expect(html).toContain('/download');
  });

  it('omits Diff on the current version instead of diffing it against itself', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { versions: 3 });

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('left=1&amp;right=3');
    expect(html).toContain('left=2&amp;right=3');
    expect(html).not.toContain('left=3&amp;right=3');
  });
});

/**
 * B-C2 keeps its subject and loses its rule: a promote form is offered only where it can submit.
 *
 * The rule used to be "markdown only, and only with at least one slot", so the HTML case was
 * asserted as an EXPLANATION with no form — a panel that said "Only markdown artifacts can be
 * promoted". Templates are reference examples now: the service takes an HTML artifact and takes an
 * artifact with no slots at all, so the form that could never submit is the form that is no longer
 * refused. Asserting the refusal is gone matters as much as asserting the form is there — a stale
 * sentence contradicting a working form is the same class of defect as a form that cannot be sent.
 */
describe('B-C2 · the Promote panel offers a form wherever the service accepts one', () => {
  it('offers the form on an HTML artifact instead of refusing it for its type', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { type: 'html' });

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('Promote to template');
    expect(html).toContain('id="template_name"');
    expect(html).toContain('id="template_slug"');
    expect(html).toContain('promote-template');
    expect(html).toContain('Save as template');
    expect(html).not.toContain('Only markdown artifacts');
  });

  it('still offers the form on a markdown artifact', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx);

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();
    expect(html).toContain('id="template_name"');
    expect(html).toContain('promote-template');
  });

  it('names the slots when there are some and stays silent when there are none', async () => {
    const ctx = await makeContext();
    const withSlots = await seed(ctx, { content: '# {{title}}\n\nBy {{author}}.' });

    const slotted = await (
      await ctx.app.request(`/dashboard/artifacts/${withSlots.artifactId}`, {
        headers: { Cookie: withSlots.cookie },
      })
    ).text();
    expect(slotted).toContain('Slots your agent can fill:');
    expect(slotted).toContain('{{title}}');
    expect(slotted).toContain('{{author}}');

    // The slot-free case is the one the old copy got wrong: "Detected slots: none yet" read as a
    // precondition the reader still had to satisfy, on a panel whose submit worked fine without it.
    const plain = await makeContext();
    const withoutSlots = await seed(plain, { type: 'html' });
    const bare = await (
      await plain.app.request(`/dashboard/artifacts/${withoutSlots.artifactId}`, {
        headers: { Cookie: withoutSlots.cookie },
      })
    ).text();
    expect(bare).not.toContain('Slots your agent can fill:');
    expect(bare).not.toContain('none yet');
  });
});

describe('B-G4 · identity is not a status', () => {
  it("renders the email as text, in the product's one account block", async () => {
    const ctx = await makeContext();
    const { cookie, email } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard', { headers: { Cookie: cookie } })
    ).text();

    // C5 reserves badge tones for state. As an info Badge the identity sat directly above
    // notice pills of identical shape and size, so chrome and feedback read as one object.
    expect(html).not.toMatch(new RegExp(`<span class="aa-badge[^"]*">${email}</span>`));
    // How MANY times the block appears is not this test's question, and it has changed three
    // times: two hand-rolled renderings, then one hand-mounted, and now two mounted by NavShell
    // from one prop so exactly one is ever live. Chasing that count here meant editing this file
    // every time the invariant improved, and two tests owning one number is how they drift apart.
    // The count lives in dashboard-r3-append.test.ts, which owns the mount invariant; this asks
    // only what B-G4 asked — that identity is text rather than a status pill.
    const block =
      `<div class="aa-button-row"><span class="aa-hint">${email}</span>` +
      '<form method="post" action="/dashboard/api/logout">' +
      '<button class="aa-btn aa-btn--secondary aa-btn--sm" type="submit">' +
      '<span>Log out</span></button></form></div>';
    expect(html).toContain(block);
  });
});

describe('B-B5 / ButtonRow · one mark, one action row', () => {
  it('stops using the brand diamond as a share-status glyph', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { share: true });

    for (const path of ['/dashboard', `/dashboard/artifacts/${artifactId}`]) {
      const html = await (await ctx.app.request(path, { headers: { Cookie: cookie } })).text();
      expect(html, path).not.toContain('◆');
      expect(html, path).toContain('Public');
    }
  });

  it('leaves no style-guide action row in the dashboard page', () => {
    const source = readFileSync('src/ui/pages/dashboard.tsx', 'utf8');
    expect(source).not.toContain('aa-specimen-row');
  });
});
