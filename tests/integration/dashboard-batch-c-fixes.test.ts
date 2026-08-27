import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { SESSION_COOKIE_NAME, SessionService } from '../../src/services/sessions.js';
import {
  createIntegrationTestContext,
  createLogCapture,
  type IntegrationTestContext,
} from '../support/integration-harness.js';
import {
  type AuthTestContext,
  cookieFrom,
  createAuthTestContext,
  formBody,
  login,
  originHeaders,
} from './auth-test-utils.js';

let authContexts: AuthTestContext[] = [];
let integrationContexts: IntegrationTestContext[] = [];

const fullBotKeyPattern = /aa_bot_[A-Za-z0-9_-]{32}/g;

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(authContexts.map((ctx) => ctx.cleanup()));
  await Promise.all(integrationContexts.map((ctx) => ctx.cleanup()));
  authContexts = [];
  integrationContexts = [];
});

async function makeAuthContext(env?: Record<string, string>): Promise<AuthTestContext> {
  const ctx = await createAuthTestContext(env);
  authContexts.push(ctx);
  return ctx;
}

async function makeIntegrationContext(
  options: Parameters<typeof createIntegrationTestContext>[0] = {}
): Promise<IntegrationTestContext> {
  const ctx = await createIntegrationTestContext(options);
  integrationContexts.push(ctx);
  return ctx;
}

describe('Batch C accepted dashboard fixes', () => {
  it('regression: setup, bot create, and bot regenerate key reveals are one-shot across refresh', async () => {
    const ctx = await makeAuthContext();

    await ctx.app.request('/setup');
    const setupToken = readFileSync(join(ctx.config.dataDir, '.setup-token'), 'utf8').trim();
    const setupResponse = await ctx.app.request('/setup', {
      method: 'POST',
      ...formBody({
        setup_token: setupToken,
        email: 'batch-c-key@example.test',
        password: 'correct horse battery staple',
        password_confirm: 'correct horse battery staple',
        bot_name: 'Batch C First Bot',
      }),
    });
    expect(setupResponse.status).toBe(303);
    expect(await setupResponse.text()).not.toMatch(fullBotKeyPattern);
    const cookie = cookieFrom(setupResponse);
    const setupRevealLocation = setupResponse.headers.get('location') ?? '/setup/key';

    const setupReveal = await ctx.app.request(setupRevealLocation, { headers: { Cookie: cookie } });
    const setupRevealBody = await setupReveal.text();
    const setupKeys = setupRevealBody.match(fullBotKeyPattern) ?? [];
    expect(setupKeys.length).toBeGreaterThan(0);
    expect(new Set(setupKeys).size).toBe(1);

    const setupRefresh = await ctx.app.request(setupRevealLocation, {
      headers: { Cookie: cookie },
    });
    const setupRefreshBody = await setupRefresh.text();
    expect(setupRefreshBody).toContain('Your key was already shown once.');
    expect(setupRefreshBody).not.toMatch(fullBotKeyPattern);

    const createHeaders = originHeaders(ctx, cookie);
    createHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
    const botCreate = await ctx.app.request('/dashboard/api/bots', {
      method: 'POST',
      headers: createHeaders,
      body: formBody({ name: 'Batch C Created Bot' }).body,
    });
    expect(botCreate.status).toBe(303);
    expect(await botCreate.text()).not.toMatch(fullBotKeyPattern);
    const botRevealLocation = botCreate.headers.get('location') ?? '/dashboard/bots';

    const botReveal = await ctx.app.request(botRevealLocation, { headers: { Cookie: cookie } });
    expect(await botReveal.text()).toMatch(fullBotKeyPattern);
    const botRefresh = await ctx.app.request(botRevealLocation, { headers: { Cookie: cookie } });
    const botRefreshBody = await botRefresh.text();
    expect(botRefreshBody).toContain('That key was shown once and is now hidden.');
    expect(botRefreshBody).not.toMatch(fullBotKeyPattern);

    const createdBot = ctx.db.sqlite
      .prepare('SELECT id, name FROM bots WHERE name = ?')
      .get('Batch C Created Bot') as { id: string; name: string };
    const regenHeaders = originHeaders(ctx, cookie);
    regenHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
    const regenerated = await ctx.app.request(`/dashboard/api/bots/${createdBot.id}/regenerate`, {
      method: 'POST',
      headers: regenHeaders,
      body: formBody({ confirm: createdBot.name }).body,
    });
    expect(regenerated.status).toBe(303);
    expect(await regenerated.text()).not.toMatch(fullBotKeyPattern);
    const regenRevealLocation = regenerated.headers.get('location') ?? '/dashboard/bots';

    const regenReveal = await ctx.app.request(regenRevealLocation, { headers: { Cookie: cookie } });
    expect(await regenReveal.text()).toMatch(fullBotKeyPattern);
    const regenRefresh = await ctx.app.request(regenRevealLocation, {
      headers: { Cookie: cookie },
    });
    const regenRefreshBody = await regenRefresh.text();
    expect(regenRefreshBody).toContain('That key was shown once and is now hidden.');
    expect(regenRefreshBody).not.toMatch(fullBotKeyPattern);
  });

  it('cloud settings are mode-aware and confirm email changes by magic link instead of password forms', async () => {
    const ctx = await makeAuthContext({ DEPLOYMENT: 'cloud' });
    const sentBodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        sentBodies.push(String(init?.body ?? ''));
        return new Response('{}', { status: 200 });
      })
    );
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('cloud-settings@example.test', 'password123');
    const session = await new SessionService(ctx.db, ctx.config).createSession(account.id);
    const cookie = `${SESSION_COOKIE_NAME}=${session.cookieValue}`;

    const settings = await ctx.app.request('/dashboard/settings', { headers: { Cookie: cookie } });
    const settingsBody = await settings.text();
    expect(settings.status).toBe(200);
    expect(settingsBody).toContain('Send confirmation link');
    expect(settingsBody).toContain('Passwordless cloud account');
    expect(settingsBody).not.toContain('name="current_password"');
    expect(settingsBody).not.toContain('Change password');

    const passwordHeaders = originHeaders(ctx, cookie);
    passwordHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
    const passwordChange = await ctx.app.request('/dashboard/api/settings/password', {
      method: 'POST',
      headers: passwordHeaders,
      body: formBody({
        current_password: 'password123',
        new_password: 'new-password',
        confirm_password: 'new-password',
      }).body,
    });
    expect(passwordChange.status).toBe(303);
    expect(passwordChange.headers.get('location')).toContain(
      'Password%20changes%20are%20unavailable'
    );

    const headers = originHeaders(ctx, cookie);
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    const requested = await ctx.app.request('/dashboard/api/settings/email', {
      method: 'POST',
      headers,
      body: formBody({ new_email: 'cloud-settings-new@example.test' }).body,
    });
    expect(requested.status).toBe(303);
    expect(requested.headers.get('location')).toContain('email_change_link_sent');
    expect(accountEmail(ctx, account.id)).toBe('cloud-settings@example.test');

    const token = sentBodies.join('\n').match(/\/auth\/change-email\?token=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    const interstitial = await ctx.app.request(`/auth/change-email?token=${token}`);
    expect(interstitial.status).toBe(200);
    expect(await interstitial.text()).toContain('Confirm your new email');
    expect(accountEmail(ctx, account.id)).toBe('cloud-settings@example.test');

    const confirmed = await ctx.app.request('/auth/change-email', {
      method: 'POST',
      ...formBody({ token: token ?? '' }),
    });
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get('location')).toBe('/dashboard/settings?notice=email_updated');
    expect(confirmed.headers.get('set-cookie')).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(accountEmail(ctx, account.id)).toBe('cloud-settings-new@example.test');
  });

  it('dashboard template preview buttons render a visible preview panel', async () => {
    const ctx = await makeAuthContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount(
      'template-preview@example.test',
      'password123'
    );
    const cookie = await login(ctx, account.email, 'password123');
    const report = ctx.db.sqlite
      .prepare("SELECT id FROM templates WHERE slug = 'report' AND account_id IS NULL")
      .get() as { id: string };

    const response = await ctx.app.request(`/dashboard/templates?preview=${report.id}`, {
      headers: { Cookie: cookie },
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('Template preview: Report');
    expect(body).toContain('Template source');
    expect(body).toContain('{{title}}');
    expect(body).toContain('{{next_steps}}');
  });

  it('dashboard share panel includes the unique-viewer count next to other counters', async () => {
    const ctx = await makeAuthContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('share-counters@example.test', 'password123');
    const { bot } = await auth.createBot(accountToCloudAccount(account), 'Counter Bot');
    const artifactService = new ArtifactService({
      db: ctx.db,
      extension: createDefaultCloudModule(ctx.config),
      baseUrl: ctx.config.baseUrl,
    });
    const created = await artifactService.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'share-counters',
      type: 'markdown',
      title: 'Share Counters',
      content: '# Share Counters',
      share: true,
    });
    ctx.db.sqlite
      .prepare('UPDATE shares SET view_count = ?, unique_viewer_count = ? WHERE id = ?')
      .run(9, 4, created.share?.shareId);
    const cookie = await login(ctx, account.email, 'password123');

    const response = await ctx.app.request(`/dashboard/artifacts/${created.artifact.id}`, {
      headers: { Cookie: cookie },
    });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('9 views on this share');
    expect(body).toContain('4 unique viewers');
  });

  it('structured request logs include dashboard and bot principals', async () => {
    const capture = createLogCapture();
    const ctx = await makeIntegrationContext({ logger: capture.logger });
    const session = await new SessionService(ctx.db, ctx.config).createSession(ctx.account.id);
    const cookie = `${SESSION_COOKIE_NAME}=${session.cookieValue}`;

    await ctx.app.request('/dashboard', { headers: { Cookie: cookie } });
    await ctx.app.request('/v1/artifacts', { headers: ctx.authHeaders });

    const requestLogs = capture.entries().filter((entry) => entry.msg === 'request.complete');
    expect(requestLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/dashboard',
          principal: { kind: 'dashboard', account_id: ctx.account.id },
        }),
        expect.objectContaining({
          path: '/v1/artifacts',
          principal: { kind: 'bot', account_id: ctx.account.id, bot_id: ctx.bot.id },
        }),
      ])
    );
  });

  it('dashboard html preview frames use lowercase utf-8 content type', async () => {
    const ctx = await makeAuthContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('frame-case@example.test', 'password123');
    const { bot } = await auth.createBot(accountToCloudAccount(account), 'Frame Bot');
    const artifactService = new ArtifactService({
      db: ctx.db,
      extension: createDefaultCloudModule(ctx.config),
      baseUrl: ctx.config.baseUrl,
    });
    const created = await artifactService.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'frame-case',
      type: 'html',
      title: 'Frame Case',
      content: '<h1>Frame Case</h1>',
      share: false,
    });
    const cookie = await login(ctx, account.email, 'password123');

    const response = await ctx.app.request(`/dashboard/artifacts/${created.artifact.id}/frame`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
  });
});

function accountEmail(ctx: AuthTestContext, accountId: string): string {
  const row = ctx.db.sqlite.prepare('SELECT email FROM accounts WHERE id = ?').get(accountId) as {
    email: string;
  };
  return row.email;
}
