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

async function seed(
  ctx: AuthTestContext,
  options: { versions?: number; share?: boolean; password?: string } = {}
): Promise<{ cookie: string; artifactId: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('detail-r4@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Detail Bot');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const created = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'detail-target',
    type: 'markdown',
    title: 'Detail Target',
    content: '# Detail Target\n\nFirst.',
    share: options.share ?? false,
  });
  if (options.password) {
    // The share is protected by a stored hash; upsert does not take a plaintext password.
    ctx.db.sqlite
      .prepare("UPDATE shares SET password_hash = 'argon2-placeholder' WHERE id = ?")
      .run(created.share?.shareId);
  }
  for (let index = 1; index < (options.versions ?? 1); index += 1) {
    await artifacts.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'detail-target',
      type: 'markdown',
      title: 'Detail Target',
      content: `# Detail Target\n\nPass ${index}.`,
      share: false,
      changeSummary: `Pass ${index}`,
    });
  }
  return {
    cookie: await login(ctx, account.email, 'password123'),
    artifactId: created.artifact.id,
  };
}

describe('B-F1 · a field and the button that submits it stop sharing one sentence', () => {
  it('names the field for what it holds, not for what the button does', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { share: true });

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    // One ternary fed both the label and the button, so a label sat 44px above a button reading
    // the same words — a stuttered instruction rather than a field and an action.
    const label = html.match(/<label[^>]*for="share_password"[^>]*>([^<]*)</)?.[1]?.trim();
    expect(label).toBe('New password');
    expect(html).toContain('Set password');
    expect(label).not.toBe('Set password');
  });

  it('keeps the action verb changing with the state, and the field label steady', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { share: true, password: 'hunter22' });

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    const label = html.match(/<label[^>]*for="share_password"[^>]*>([^<]*)</)?.[1]?.trim();
    expect(label).toBe('New password');
    expect(html).toContain('Change password');
  });
});

describe('B-D4 · the risk ladder stops being inverted', () => {
  it('makes Restore a confirmation that names the version, not a one-click POST', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { versions: 3 });

    const html = await (
      await ctx.app.request(`/dashboard/artifacts/${artifactId}`, { headers: { Cookie: cookie } })
    ).text();

    // Revoking a link demanded a typed slug while restoring — which rewrites what every reader of
    // the current version sees — was one click. The ladder ran the wrong way round.
    expect(html).not.toMatch(
      /<form[^>]*action="[^"]*\/restore"[^>]*>(?:(?!<\/form>)[\s\S])*?<button/
    );
    expect(html).toContain('data-aa-open-dialog="restore-version-1-dialog"');
    expect(html).toContain('data-aa-open-dialog="restore-version-2-dialog"');
    // The version number is what is worth checking: restoring is reversible, restoring the WRONG
    // version is the mistake, so that is what the reader types.
    expect(html).toContain('data-aa-confirm-match="v1"');
  });

  it('still restores when the typed version matches', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { versions: 3 });
    const headers = new Headers({
      Cookie: cookie,
      Origin: ctx.config.baseUrl,
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    const restored = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/restore`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ version: '1', confirm: 'v1' }),
    });
    expect(restored.status).toBe(303);
    expect(restored.headers.get('location')).toContain('notice=artifact_restored');
  });

  it('refuses when the typed version does not match the one being restored', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seed(ctx, { versions: 3 });
    const headers = new Headers({
      Cookie: cookie,
      Origin: ctx.config.baseUrl,
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    const refused = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/restore`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({ version: '1', confirm: 'v2' }),
    });
    expect(refused.status).toBe(303);
    expect(refused.headers.get('location')).toContain('notice=restore_confirm_mismatch');
  });
});
