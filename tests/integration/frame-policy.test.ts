import { describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { createAuthTestContext, login } from './auth-test-utils.js';

const DASHBOARD_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: https:',
  "font-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  'sandbox allow-scripts',
].join('; ');

describe('central frame policy', () => {
  it('preserves dashboard owner HTML preview frame headers byte-for-byte', async () => {
    const ctx = await createAuthTestContext();
    try {
      const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
      const account = await auth.createPasswordAccount('frame-policy@example.test', 'password123');
      const { bot } = await auth.createBot(accountToCloudAccount(account), 'Frame Policy Bot');
      const artifacts = new ArtifactService({
        db: ctx.db,
        extension: createDefaultCloudModule(ctx.config),
        baseUrl: ctx.config.baseUrl,
      });
      const created = await artifacts.upsertArtifact({
        account: accountToCloudAccount(account),
        bot: { id: bot.id, name: bot.name, byline: bot.byline },
        slug: 'dashboard-frame-policy',
        type: 'html',
        title: 'Dashboard Frame Policy',
        content: '<!doctype html><h1>Dashboard frame policy</h1>',
        share: false,
      });
      const cookie = await login(ctx, account.email, 'password123');

      const response = await ctx.app.request(`/dashboard/artifacts/${created.artifact.id}/frame`, {
        headers: { Cookie: cookie },
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('<h1>Dashboard frame policy</h1>');
      expect(response.headers.get('content-type')).toBe('text/html; charset=UTF-8');
      expect(response.headers.get('content-security-policy')).toBe(DASHBOARD_PREVIEW_CSP);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(response.headers.get('permissions-policy')).toBe(
        'camera=(), microphone=(), geolocation=(), payment=()'
      );
      expect(response.headers.get('cross-origin-resource-policy')).toBeNull();
      expect(response.headers.get('set-cookie')).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
