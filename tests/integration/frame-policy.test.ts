import { describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { type FramePolicyVariant, frameCsp } from '../../src/lib/frame-policy.js';
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
  // The pin moves for the first time since T3, and only here: the dashboard-preview variant was
  // the one frame response in the codebase with no framing restriction at all. Same-origin,
  // because the dashboard embeds this route with a relative `src`.
  "frame-ancestors 'self'",
  'sandbox allow-scripts',
].join('; ');

describe('central frame policy', () => {
  it('leaves no frame variant without a framing restriction', () => {
    // The defect this guards was an omission, not a wrong value: the dashboard-preview variant
    // simply had no `frame-ancestors` at all, making it the only frame response in the codebase
    // that any site could embed. An omission is invisible to a test that checks what is present,
    // so this one checks the whole set — a third variant cannot forget.
    const variants: FramePolicyVariant[] = ['public-artifact', 'dashboard-preview'];
    const config = { baseUrl: 'https://agentartifact.example.test' } as never;

    for (const variant of variants) {
      const directives = frameCsp(config, variant).split('; ');

      expect(
        directives.some((directive) => directive.startsWith('frame-ancestors ')),
        `${variant} declares no frame-ancestors`
      ).toBe(true);
      // `default-src` does not cover framing: `frame-ancestors` has no fallback, which is exactly
      // why the omission read as safe.
      expect(
        directives.filter((d) => d.startsWith('frame-ancestors ')),
        variant
      ).toHaveLength(1);
    }
  });

  it('restricts each variant to the origin that actually embeds it', () => {
    const config = { baseUrl: 'https://agentartifact.example.test' } as never;

    // Cross-origin by design: served from the sandbox host, framed by the app host.
    expect(frameCsp(config, 'public-artifact')).toContain(
      'frame-ancestors https://agentartifact.example.test'
    );
    // Same-origin by construction: the dashboard embeds it with a relative src.
    expect(frameCsp(config, 'dashboard-preview')).toContain("frame-ancestors 'self'");
  });

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
      // Deliberately approved policy change: the original uppercase charset was accidental;
      // lowercase utf-8 is canonical and matches the rest of the application.
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
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
