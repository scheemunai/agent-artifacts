import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/services/auth.js';
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

async function makeContext(env?: Record<string, string>): Promise<AuthTestContext> {
  const ctx = await createAuthTestContext(env);
  contexts.push(ctx);
  return ctx;
}

describe('M4 session security', () => {
  it('sets session cookie flags with Secure iff BASE_URL is https', async () => {
    const httpCtx = await makeContext({ BASE_URL: 'http://localhost:3000' });
    const httpAuth = new AuthService(httpCtx.db, httpCtx.config, httpCtx.logger);
    const httpAccount = await httpAuth.createPasswordAccount('http@example.test', 'password123');
    const httpResponse = await httpCtx.app.request('/login', {
      method: 'POST',
      ...formBody({ email: httpAccount.email, password: 'password123', mode: 'password' }),
    });
    const httpCookie = httpResponse.headers.get('set-cookie') ?? '';
    expect(httpCookie).toContain('aa_session=');
    expect(httpCookie).toContain('HttpOnly');
    expect(httpCookie).toContain('SameSite=Lax');
    expect(httpCookie).toContain('Path=/');
    expect(httpCookie).not.toContain('Domain=');
    expect(hasSecureFlag(httpCookie)).toBe(false);

    const httpsCtx = await makeContext({ BASE_URL: 'https://agent.example.test' });
    const httpsAuth = new AuthService(httpsCtx.db, httpsCtx.config, httpsCtx.logger);
    const httpsAccount = await httpsAuth.createPasswordAccount('https@example.test', 'password123');
    const httpsResponse = await httpsCtx.app.request('/login', {
      method: 'POST',
      ...formBody({ email: httpsAccount.email, password: 'password123', mode: 'password' }),
    });
    const httpsCookie = httpsResponse.headers.get('set-cookie') ?? '';
    expect(httpsCookie).toContain('aa_session=');
    expect(httpsCookie).toContain('HttpOnly');
    expect(httpsCookie).toContain('SameSite=Lax');
    expect(httpsCookie).toContain('Path=/');
    expect(httpsCookie).not.toContain('Domain=');
    expect(hasSecureFlag(httpsCookie)).toBe(true);
  });

  it('rejects dashboard mutations with origin_mismatch when Origin/Referer do not match BASE_URL', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('csrf@example.test', 'password123');
    const cookie = await login(ctx, account.email, 'password123');

    const response = await ctx.app.request('/dashboard/api/logout', {
      method: 'POST',
      headers: new Headers({ Cookie: cookie, Origin: 'https://evil.example.test' }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'origin_mismatch', message: 'Origin mismatch' },
    });
  });

  it('accepts dashboard mutations when Referer origin matches BASE_URL', async () => {
    const ctx = await makeContext();
    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('referer@example.test', 'password123');
    const cookie = await login(ctx, account.email, 'password123');
    const headers = originHeaders(ctx, cookie);
    headers.delete('Origin');
    headers.set('Referer', `${ctx.config.baseUrl}/dashboard/settings`);

    const response = await ctx.app.request('/dashboard/api/logout', {
      method: 'POST',
      headers,
    });

    expect(response.status).toBe(303);
  });
});

function hasSecureFlag(setCookie: string): boolean {
  return setCookie.split(';').some((part) => part.trim() === 'Secure');
}
