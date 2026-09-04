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
  const account = await auth.createPasswordAccount('cursor-r4@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Cursor Bot');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  for (let index = 0; index < 3; index += 1) {
    await artifacts.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: `cursor-${index}`,
      type: 'markdown',
      title: `Cursor ${index}`,
      content: `# Cursor ${index}`,
      share: false,
    });
  }
  return { cookie: await login(ctx, account.email, 'password123') };
}

describe('B-C9 · a cursor that no longer decodes says so', () => {
  it('does not silently serve page one while the URL still claims a later page', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const response = await ctx.app.request('/dashboard/artifacts?cursor=notarealcursor', {
      headers: { Cookie: cookie },
    });

    // The cursor decoded to null and was dropped from the query, so the reader got page one while
    // the address bar still said they were deeper in the list — and, since V3-N1 reads `cursor` to
    // decide its wording, the footer confidently called it "on this page". Two subsystems agreeing
    // on a lie because neither was told the cursor had failed.
    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('notice=cursor_expired');
    // The broken cursor has to leave the URL, or a refresh walks straight back into it.
    expect(location).not.toContain('cursor=');
  });

  it('keeps the filters the reader chose while dropping only the cursor', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const response = await ctx.app.request(
      '/dashboard/artifacts?q=cursor&type=markdown&cursor=bogus',
      {
        headers: { Cookie: cookie },
      }
    );

    const location = response.headers.get('location') ?? '';
    // Throwing the reader back to an unfiltered list would be a second, larger surprise than the
    // one being reported.
    expect(location).toContain('q=cursor');
    expect(location).toContain('type=markdown');
    expect(location).not.toContain('cursor=bogus');
  });

  it('leaves a working cursor alone', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const valid = Buffer.from(JSON.stringify({ updatedAt: Date.now(), id: 'art_x' })).toString(
      'base64url'
    );
    const response = await ctx.app.request(`/dashboard/artifacts?cursor=${valid}`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
  });

  it('renders the notice as product copy, never as text from the query string', async () => {
    const ctx = await makeContext();
    const { cookie } = await seed(ctx);

    const html = await (
      await ctx.app.request('/dashboard/artifacts?notice=cursor_expired', {
        headers: { Cookie: cookie },
      })
    ).text();
    expect(html).toContain('first page');
    // The closed-vocabulary rule: an unknown code renders nothing at all.
    const injected = await (
      await ctx.app.request('/dashboard/artifacts?notice=your+account+is+suspended', {
        headers: { Cookie: cookie },
      })
    ).text();
    expect(injected).not.toContain('your account is suspended');
  });
});
