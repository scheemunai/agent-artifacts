import { describe, expect, it } from 'vitest';
import { AuthService } from '../../src/services/auth.js';
import { createAuthTestContext, formBody } from './auth-test-utils.js';

describe('auth route rate limiting', () => {
  it('preserves password-login HTML 429 behavior through the central limiter', async () => {
    const ctx = await createAuthTestContext({ AA_RATE_LIMITS_DISABLED: 'false' });
    try {
      const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
      const account = await auth.createPasswordAccount(
        'limited-password@example.test',
        'password123'
      );

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const form = formBody({
          email: account.email,
          password: `wrong-${attempt}`,
          mode: 'password',
        });
        const response = await ctx.app.request('/login', {
          method: 'POST',
          headers: form.headers,
          body: form.body,
        });
        expect(response.status).toBe(401);
      }

      const form = formBody({ email: account.email, password: 'password123', mode: 'password' });
      const response = await ctx.app.request('/login', {
        method: 'POST',
        headers: form.headers,
        body: form.body,
      });
      const html = await response.text();

      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBeNull();
      expect(response.headers.get('x-ratelimit-limit')).toBeNull();
      expect(html).toContain('Too many attempts. Try again later.');
    } finally {
      await ctx.cleanup();
    }
  });

  it('preserves magic-link HTML 429 behavior through the central limiter', async () => {
    const ctx = await createAuthTestContext({
      AA_RATE_LIMITS_DISABLED: 'false',
      AA_MAIL_TRANSPORT: 'log',
    });
    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const form = formBody({
          email: 'limited-magic@example.test',
          mode: 'magic',
        });
        const response = await ctx.app.request('/login', {
          method: 'POST',
          headers: form.headers,
          body: form.body,
        });
        expect(response.status).toBe(200);
      }

      const form = formBody({ email: 'limited-magic@example.test', mode: 'magic' });
      const response = await ctx.app.request('/login', {
        method: 'POST',
        headers: form.headers,
        body: form.body,
      });
      const html = await response.text();

      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBeNull();
      expect(response.headers.get('x-ratelimit-limit')).toBeNull();
      expect(html).toContain('Too many links requested. Try again later.');
    } finally {
      await ctx.cleanup();
    }
  });
});
