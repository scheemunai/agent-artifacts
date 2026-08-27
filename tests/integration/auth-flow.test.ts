import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount, MAGIC_LINK_TTL_MS } from '../../src/services/auth.js';
import { hashToken } from '../../src/services/sessions.js';
import {
  type AuthTestContext,
  cookieFrom,
  countRows,
  createAuthTestContext,
  formBody,
  login,
  originHeaders,
} from './auth-test-utils.js';

let contexts: AuthTestContext[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(contexts.map((ctx) => ctx.cleanup()));
  contexts = [];
});

async function makeContext(env?: Record<string, string>): Promise<AuthTestContext> {
  const ctx = await createAuthTestContext(env);
  contexts.push(ctx);
  return ctx;
}

describe('M4 auth flow', () => {
  it('setup wizard rejects step 1 without the boot-log token and deletes it on completion', async () => {
    const ctx = await makeContext();

    await ctx.app.request('/setup');
    const setupTokenPath = join(ctx.config.dataDir, '.setup-token');
    const setupToken = readFileSync(setupTokenPath, 'utf8').trim();
    expect(setupToken).toHaveLength(24);
    expect(statSync(setupTokenPath).mode & 0o777).toBe(0o600);

    const rejected = await ctx.app.request('/setup', {
      method: 'POST',
      ...formBody({
        email: 'admin@example.test',
        password: 'correct horse battery staple',
        password_confirm: 'correct horse battery staple',
        bot_name: 'R2',
      }),
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).toContain('Setup token is required');

    const accepted = await ctx.app.request('/setup', {
      method: 'POST',
      ...formBody({
        setup_token: setupToken,
        email: 'admin@example.test',
        password: 'correct horse battery staple',
        password_confirm: 'correct horse battery staple',
        bot_name: 'R2',
        bot_byline: "Andrej's Chief of Staff",
      }),
    });

    expect(accepted.status).toBe(303);
    expect(accepted.headers.get('set-cookie')).toContain('aa_session=');
    const keyLocation = accepted.headers.get('location');
    expect(keyLocation).toMatch(/^\/setup\/key\?reveal=/);
    const body = await (
      await ctx.app.request(keyLocation ?? '/', { headers: { Cookie: cookieFrom(accepted) } })
    ).text();
    expect(body).toContain('aa_bot_');
    expect(body).toContain('Confirm setup by creating your first artifact');
    expect(existsSync(setupTokenPath)).toBe(false);
    expect(countRows(ctx.db, 'accounts')).toBe(1);
    expect(countRows(ctx.db, 'bots')).toBe(1);
  });

  it('GET /auth/verify does not consume a magic-link token; the interstitial POST does', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('magic@example.test', 'password123');
    const issued = await auth.requestMagicLink(account.email);
    expect(issued.token).toBeTruthy();
    const token = issued.token ?? '';
    const tokenHash = hashToken(token);

    const getResponse = await ctx.app.request(`/auth/verify?token=${token}`);
    expect(getResponse.status).toBe(200);
    expect(await getResponse.text()).toContain('Continue');
    expect(consumedAt(ctx, tokenHash)).toBeNull();

    const postResponse = await ctx.app.request('/auth/verify', {
      method: 'POST',
      ...formBody({ token }),
    });
    expect(postResponse.status).toBe(303);
    expect(postResponse.headers.get('set-cookie')).toContain('aa_session=');
    expect(consumedAt(ctx, tokenHash)).toEqual(expect.any(Number));

    const replay = await ctx.app.request('/auth/verify', {
      method: 'POST',
      ...formBody({ token }),
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('set-cookie')).toBeNull();
    expect(await replay.text()).toContain('That link has expired');
  });

  it('magic-link tokens expire after 15 minutes', async () => {
    const now = 1_800_000_000_000;
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger, () => now);
    const account = await auth.createPasswordAccount('expired@example.test', 'password123');
    const issued = await auth.requestMagicLink(account.email);
    const expiredAuth = new AuthService(
      ctx.db,
      ctx.config,
      ctx.logger,
      () => now + MAGIC_LINK_TTL_MS + 1
    );

    await expect(expiredAuth.consumeMagicLink(issued.token ?? '')).resolves.toMatchObject({
      ok: false,
    });
  });

  it('password login round-trips through argon2id, logout, and re-login after password change', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('admin@example.test', 'old-password');
    expect(account.passwordHash).toMatch(/^\$argon2id\$/);

    const firstCookie = await login(ctx, account.email, 'old-password');
    const changeForm = formBody({
      current_password: 'old-password',
      new_password: 'new-password',
      confirm_password: 'new-password',
    });
    const changeHeaders = originHeaders(ctx, firstCookie);
    changeHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
    const changed = await ctx.app.request('/dashboard/api/settings/password', {
      method: 'POST',
      headers: changeHeaders,
      body: changeForm.body,
    });
    expect(changed.status).toBe(303);
    const secondCookie = cookieFrom(changed);
    expect(secondCookie).not.toBe(firstCookie);

    const logoutHeaders = originHeaders(ctx, secondCookie);
    const logout = await ctx.app.request('/dashboard/api/logout', {
      method: 'POST',
      headers: logoutHeaders,
    });
    expect(logout.status).toBe(303);

    const oldLogin = await ctx.app.request('/login', {
      method: 'POST',
      ...formBody({ email: account.email, password: 'old-password', mode: 'password' }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await ctx.app.request('/login', {
      method: 'POST',
      ...formBody({ email: account.email, password: 'new-password', mode: 'password' }),
    });
    expect(newLogin.status).toBe(303);
  });

  it('deleting the account hard-deletes artifacts and shares so public URLs return 404', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('delete@example.test', 'password123');
    const { bot } = await auth.createBot(accountToCloudAccount(account), 'R2');
    const artifactService = new ArtifactService({
      db: ctx.db,
      extension: createDefaultCloudModule(ctx.config),
      baseUrl: ctx.config.baseUrl,
    });
    const result = await artifactService.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'delete-me',
      type: 'markdown',
      title: 'Delete Me',
      content: '# Delete Me',
      share: true,
    });
    const shareId = result.share?.shareId;
    expect(shareId).toBeTruthy();

    const cookie = await login(ctx, account.email, 'password123');
    const deleteForm = formBody({ confirm_email: account.email });
    const headers = originHeaders(ctx, cookie);
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    const deleted = await ctx.app.request('/dashboard/api/settings/delete', {
      method: 'POST',
      headers,
      body: deleteForm.body,
    });
    expect(deleted.status).toBe(303);
    expect(countRows(ctx.db, 'accounts')).toBe(0);
    expect(countRows(ctx.db, 'artifacts')).toBe(0);
    expect(countRows(ctx.db, 'shares')).toBe(0);

    const publicResponse = await ctx.app.request(`/a/${shareId}`);
    expect(publicResponse.status).toBe(404);
  });

  it('key regeneration invalidates the old key immediately', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('keys@example.test', 'password123');
    const { bot, apiKey: oldKey } = await auth.createBot(accountToCloudAccount(account), 'R2');

    await expect(auth.verifyBotKey(oldKey)).resolves.toMatchObject({ bot: { id: bot.id } });
    const { apiKey: newKey } = await auth.regenerateBotKey(account.id, bot.id, 'R2');

    await expect(auth.verifyBotKey(oldKey)).resolves.toBeNull();
    await expect(auth.verifyBotKey(newKey)).resolves.toMatchObject({ bot: { id: bot.id } });
  });

  it('magic-link login gives known and unknown emails the same non-enumerating response shape', async () => {
    const ctx = await makeContext({ DEPLOYMENT: 'cloud' });
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    await auth.createPasswordAccount('known@example.test', 'password123');

    const known = await ctx.app.request('/login', {
      method: 'POST',
      ...formBody({ email: 'known@example.test', mode: 'magic' }),
    });
    const unknown = await ctx.app.request('/login', {
      method: 'POST',
      ...formBody({ email: 'unknown@example.test', mode: 'magic' }),
    });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const knownBody = await known.text();
    const unknownBody = await unknown.text();
    expect(knownBody).toContain('Check your email');
    expect(unknownBody).toContain('Check your email');
    expect(knownBody).not.toContain('incorrect');
    expect(unknownBody).not.toContain('incorrect');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

function consumedAt(ctx: AuthTestContext, tokenHash: string): number | null {
  const row = ctx.db.sqlite
    .prepare('SELECT consumed_at FROM magic_link_tokens WHERE token_hash = ?')
    .get(tokenHash) as { consumed_at: number | null };
  return row.consumed_at;
}
