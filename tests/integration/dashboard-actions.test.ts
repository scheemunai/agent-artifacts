import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
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

describe('M4 dashboard screens and actions', () => {
  it('renders every dashboard screen and updates shares/templates through dashboard mutations', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('dash@example.test', 'password123');
    const { bot } = await auth.createBot(accountToCloudAccount(account), 'R2', 'Chief of Staff');
    const artifactService = new ArtifactService({
      db: ctx.db,
      extension: createDefaultCloudModule(ctx.config),
      baseUrl: ctx.config.baseUrl,
    });
    const first = await artifactService.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'weekly-report',
      type: 'markdown',
      title: 'Weekly Report',
      content: '# Weekly\n\n{{summary}}',
      share: false,
    });
    await artifactService.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'weekly-report',
      type: 'markdown',
      title: 'Weekly Report',
      content: '# Weekly\n\n{{summary}} updated',
      share: false,
      changeSummary: 'Updated summary',
    });
    const cookie = await login(ctx, account.email, 'password123');

    const dashboard = await ctx.app.request('/dashboard?q=weekly&type=markdown', {
      headers: { Cookie: cookie },
    });
    expect(dashboard.status).toBe(200);
    const dashboardBody = await dashboard.text();
    expect(dashboardBody).toContain('Weekly Report');
    expect(dashboardBody).toContain('weekly-report');
    expect(dashboardBody).toContain('R2');

    const detail = await ctx.app.request(`/dashboard/artifacts/${first.artifact.id}`, {
      headers: { Cookie: cookie },
    });
    expect(detail.status).toBe(200);
    const detailBody = await detail.text();
    expect(detailBody).toContain('Rendered preview');
    expect(detailBody).toContain('Version history');
    expect(detailBody).toContain('Promote to template');

    const headers = originHeaders(ctx, cookie);
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    const shareCreated = await ctx.app.request(
      `/dashboard/api/artifacts/${first.artifact.id}/share`,
      {
        method: 'POST',
        headers,
        body: formBody({ password: 'secret-pass' }).body,
      }
    );
    expect(shareCreated.status).toBe(303);
    const share = ctx.db.sqlite
      .prepare('SELECT * FROM shares WHERE artifact_id = ? AND revoked_at IS NULL')
      .get(first.artifact.id) as { id: string; password_hash: string | null };
    expect(share.password_hash).toMatch(/^\$argon2id\$/);

    const promoteHeaders = originHeaders(ctx, cookie);
    promoteHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
    const promoted = await ctx.app.request(
      `/dashboard/api/artifacts/${first.artifact.id}/promote-template`,
      {
        method: 'POST',
        headers: promoteHeaders,
        body: formBody({ name: 'Weekly Template', slug: 'weekly-template' }).body,
      }
    );
    expect(promoted.status).toBe(303);
    const templates = await ctx.app.request('/dashboard/templates', {
      headers: { Cookie: cookie },
    });
    expect(templates.status).toBe(200);
    expect(await templates.text()).toContain('Weekly Template');

    const bots = await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } });
    expect(bots.status).toBe(200);
    expect(await bots.text()).toContain('Regenerate key');

    const settings = await ctx.app.request('/dashboard/settings', { headers: { Cookie: cookie } });
    expect(settings.status).toBe(200);
    expect(await settings.text()).toContain('Delete account');
  });

  it('shows an inline error when an html artifact is promoted to a template', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('html@example.test', 'password123');
    const { bot } = await auth.createBot(accountToCloudAccount(account), 'HTML Bot');
    const artifactService = new ArtifactService({
      db: ctx.db,
      extension: createDefaultCloudModule(ctx.config),
      baseUrl: ctx.config.baseUrl,
    });
    const result = await artifactService.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'html-artifact',
      type: 'html',
      title: 'HTML Artifact',
      content: '<h1>HTML</h1>',
      share: false,
    });
    const cookie = await login(ctx, account.email, 'password123');
    const headers = originHeaders(ctx, cookie);
    headers.set('Content-Type', 'application/x-www-form-urlencoded');

    const response = await ctx.app.request(
      `/dashboard/api/artifacts/${result.artifact.id}/promote-template`,
      {
        method: 'POST',
        headers,
        body: formBody({ name: 'HTML Template', slug: 'html-template' }).body,
      }
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/dashboard/templates?notice=template_promoted');
    const template = ctx.db.sqlite
      .prepare('SELECT type, thumbnail_url FROM templates WHERE slug = ?')
      .get('html-template') as { type: string; thumbnail_url: string | null };
    expect(template).toEqual({ type: 'html', thumbnail_url: null });
  });
});
