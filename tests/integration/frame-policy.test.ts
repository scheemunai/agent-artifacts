import { describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { FRAME_POLICY_VARIANTS, frameCsp } from '../../src/lib/frame-policy.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { createAuthTestContext, login } from './auth-test-utils.js';

const OWNER_PREVIEW_CSP = [
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
  // because on a deployment with one host the dashboard and the preview share an origin. The
  // cloud shape — where they do not — is pinned separately below.
  "frame-ancestors 'self'",
  'sandbox allow-scripts',
].join('; ');

describe('central frame policy', () => {
  it('leaves no frame variant without a framing restriction', () => {
    // The defect this guards was an omission, not a wrong value: the dashboard-preview variant
    // simply had no `frame-ancestors` at all, making it the only frame response in the codebase
    // that any site could embed. An omission is invisible to a test that checks what is present,
    // so this one checks the whole set.
    //
    // It walks the exported variant list rather than a literal written here. The first version of
    // this test claimed "a third variant cannot forget" while iterating two hand-typed strings —
    // a second list that agrees with the type until someone adds a variant to only one of them,
    // which is the same list-vs-walk shape retired from the style-guide guard the same evening.
    const config = { baseUrl: 'https://agentartifact.example.test' } as never;

    expect(FRAME_POLICY_VARIANTS.length).toBeGreaterThan(1);

    for (const variant of FRAME_POLICY_VARIANTS) {
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
    // One host, so the dashboard and the preview share an origin and `'self'` names it exactly.
    expect(frameCsp(config, 'owner-preview')).toContain("frame-ancestors 'self'");
  });

  it('names the app origin as the owner preview embedder wherever the hosts differ', () => {
    // The directive that had to learn where it is running. On cloud the owner preview is served by
    // the sandbox host and framed by the app host — the same cross-origin arrangement the public
    // variant has always had — so `'self'` would name the *sandbox* origin and refuse the only
    // embedder there is.
    const cloud = {
      baseUrl: 'https://agentartifact.example.test',
      sandboxOrigin: 'https://usercontent.example.test',
    } as never;

    expect(frameCsp(cloud, 'owner-preview')).toContain(
      'frame-ancestors https://agentartifact.example.test'
    );
    expect(frameCsp(cloud, 'owner-preview')).not.toContain("frame-ancestors 'self'");
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

      // Through the page, not by guessing the URL: the preview frame is now reached by a token the
      // detail page mints, and asserting the headers on a URL the product does not actually emit
      // is how the CSP defect survived every green test of the route it replaced.
      const page = await ctx.app.request(`/dashboard/artifacts/${created.artifact.id}`, {
        headers: { Cookie: cookie },
      });
      const src = (await page.text()).match(
        /<iframe[^>]*\ssrc="([^"]*\/preview\/[^"]*)"/
      )?.[1] as string;
      expect(src, 'the detail page rendered no owner preview iframe').toBeDefined();

      const response = await ctx.app.request(src);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('<h1>Dashboard frame policy</h1>');
      // Deliberately approved policy change: the original uppercase charset was accidental;
      // lowercase utf-8 is canonical and matches the rest of the application.
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('content-security-policy')).toBe(OWNER_PREVIEW_CSP);
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
      expect(response.headers.get('permissions-policy')).toBe(
        'camera=(), microphone=(), geolocation=(), payment=()'
      );
      // Two additions, both consequences of the move to a token URL on a second host: the response
      // is one owner's private draft and must never enter a shared cache, and it is now fetched
      // cross-origin like the public frame beside it.
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(response.headers.get('set-cookie')).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
