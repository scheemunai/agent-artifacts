import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { SHARE_ID_PATTERN } from '../../src/services/viewer.js';
import {
  type AuthTestContext,
  createAuthTestContext,
  formBody,
  login,
  originHeaders,
} from './auth-test-utils.js';

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

async function seedArtifact(
  ctx: AuthTestContext,
  input: {
    email: string;
    slug: string;
    title: string;
    content: string;
    type?: 'markdown' | 'html';
  }
): Promise<{
  account: Awaited<ReturnType<AuthService['createPasswordAccount']>>;
  artifactId: string;
  cookie: string;
}> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount(input.email, 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Fix Bot', 'QA');
  const artifactService = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const result = await artifactService.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: input.slug,
    type: input.type ?? 'markdown',
    title: input.title,
    content: input.content,
    share: false,
  });
  const cookie = await login(ctx, account.email, 'password123');
  return { account, artifactId: result.artifact.id, cookie };
}

function dashboardFormHeaders(ctx: AuthTestContext, cookie: string): Headers {
  const headers = originHeaders(ctx, cookie);
  headers.set('Content-Type', 'application/x-www-form-urlencoded');
  return headers;
}

describe('critical dashboard share/template fixes', () => {
  it('dashboard-created share uses the public bare nanoid route pattern and resolves', async () => {
    const ctx = await makeContext();
    const { artifactId, cookie } = await seedArtifact(ctx, {
      email: 'share-resolves@example.test',
      slug: 'dashboard-share-resolves',
      title: 'Dashboard Share Resolves',
      content: '# Dashboard Share Resolves\n\nCreated from the dashboard.',
    });

    const created = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/share`, {
      method: 'POST',
      headers: dashboardFormHeaders(ctx, cookie),
      body: formBody({}).body,
    });

    expect(created.status).toBe(303);
    const share = ctx.db.sqlite
      .prepare('SELECT id FROM shares WHERE artifact_id = ? AND revoked_at IS NULL')
      .get(artifactId) as { id: string };
    expect(share.id).toMatch(SHARE_ID_PATTERN);
    expect(share.id).not.toMatch(/^sha_/);

    const publicPage = await ctx.app.request(`/a/${share.id}`);
    expect(publicPage.status).toBe(200);
    expect(await publicPage.text()).toContain('Dashboard Share Resolves');
  });

  it('dashboard password removal stamps password_updated_at and invalidates the old viewer token MAC', async () => {
    const ctx = await makeContext();
    const { artifactId, cookie } = await seedArtifact(ctx, {
      email: 'share-password-remove@example.test',
      slug: 'dashboard-share-password-remove',
      title: 'Dashboard Share Password Remove',
      content: '# Secret\n\nPassword-protected content.',
    });

    const created = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/share`, {
      method: 'POST',
      headers: dashboardFormHeaders(ctx, cookie),
      body: formBody({ password: 'secret-pass' }).body,
    });
    expect(created.status).toBe(303);

    const initial = ctx.db.sqlite
      .prepare('SELECT id, password_hash FROM shares WHERE artifact_id = ? AND revoked_at IS NULL')
      .get(artifactId) as { id: string; password_hash: string };
    ctx.db.sqlite
      .prepare('UPDATE shares SET password_updated_at = ? WHERE id = ?')
      .run(1_000, initial.id);

    const verified = await ctx.app.request(`/a/${initial.id}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret-pass' }),
    });
    expect(verified.status).toBe(200);
    const verifiedBody = (await verified.json()) as { viewer_token: string };
    expect(verifiedBody.viewer_token).toMatch(/^[0-9]+\.[0-9a-f]+$/);

    const removed = await ctx.app.request(
      `/dashboard/api/artifacts/${artifactId}/share/password/remove`,
      {
        method: 'POST',
        headers: dashboardFormHeaders(ctx, cookie),
        body: formBody({}).body,
      }
    );
    expect(removed.status).toBe(303);

    const afterRemoval = ctx.db.sqlite
      .prepare('SELECT password_hash, password_updated_at FROM shares WHERE id = ?')
      .get(initial.id) as { password_hash: string | null; password_updated_at: number | null };
    expect(afterRemoval.password_hash).toBeNull();
    expect(afterRemoval.password_updated_at).toEqual(expect.any(Number));
    expect(afterRemoval.password_updated_at).toBeGreaterThan(1_000);

    // Public shares do not need an access token. Re-applying the previous hash without changing
    // password_updated_at lets the test exercise the MAC binding created by the removal timestamp.
    ctx.db.sqlite
      .prepare('UPDATE shares SET password_hash = ? WHERE id = ?')
      .run(initial.password_hash, initial.id);
    const staleTokenContent = await ctx.app.request(`/a/${initial.id}/content`, {
      headers: { 'X-AA-Share-Token': verifiedBody.viewer_token },
    });
    expect(staleTokenContent.status).toBe(401);
    expect(await staleTokenContent.json()).toMatchObject({
      error: { code: 'password_required' },
    });
  });

  it('dashboard template promotion uses the canonical template service slots shape', async () => {
    const ctx = await makeContext();
    const { artifactId, cookie } = await seedArtifact(ctx, {
      email: 'canonical-template@example.test',
      slug: 'canonical-template-source',
      title: 'Canonical Template Source',
      content: '# Report\n\nSummary: {{summary}}',
    });

    const promoted = await ctx.app.request(
      `/dashboard/api/artifacts/${artifactId}/promote-template`,
      {
        method: 'POST',
        headers: dashboardFormHeaders(ctx, cookie),
        body: formBody({
          name: 'Canonical Dashboard Template',
          slug: 'canonical-dashboard-template',
        }).body,
      }
    );

    expect(promoted.status).toBe(303);
    const template = ctx.db.sqlite
      .prepare('SELECT slots, created_from_artifact FROM templates WHERE slug = ?')
      .get('canonical-dashboard-template') as { slots: string; created_from_artifact: string };
    expect(template.created_from_artifact).toBe(artifactId);
    expect(JSON.parse(template.slots)).toEqual([
      { name: 'summary', description: 'Slot summary', required: true },
    ]);
  });
});
