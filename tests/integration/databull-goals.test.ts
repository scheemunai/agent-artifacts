import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import {
  type AuthTestContext,
  cookieFrom,
  createAuthTestContext,
  formBody,
  login,
  originHeaders,
} from './auth-test-utils.js';

const SITE_ID = 'dc_TESTonlyIdNotReal000';
let contexts: AuthTestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.map((context) => context.cleanup()));
  contexts = [];
});

async function contextWithAnalytics(): Promise<AuthTestContext> {
  const context = await createAuthTestContext({ AA_DATABULL_SITE_ID: SITE_ID });
  contexts.push(context);
  return context;
}

describe('DataBull outcomes rendered by successful dashboard flows', () => {
  it('renders a one-load identify marker after magic-link verification with user_id only', async () => {
    const context = await contextWithAnalytics();
    const auth = new AuthService(context.db, context.config, context.logger);
    const account = await auth.createPasswordAccount('private-profile@example.test', 'password123');
    const issued = await auth.requestMagicLink(account.email);

    const verified = await context.app.request('/auth/verify', {
      method: 'POST',
      ...formBody({ token: issued.token ?? '' }),
    });
    expect(verified.status).toBe(303);
    expect(verified.headers.get('location')).toBe('/dashboard?identify=1');

    const dashboard = await context.app.request('/dashboard?identify=1', {
      headers: { Cookie: cookieFrom(verified) },
    });
    const html = await dashboard.text();
    // Suppressing analytics on the token-bearing interstitial must not suppress the post-login
    // landing page where this one-load identify marker is consumed.
    expect(html).toContain('databull.subscriptions-972.workers.dev/js/script.js');
    expect(html).toContain(`data-website-id="${SITE_ID}"`);
    expect(html).toContain(`data-dc-identify-user="${account.id}"`);
    expect(html).not.toContain('data-dc-identify-email');
    expect(html).not.toContain('data-dc-identify-name');
    expect(html).not.toContain('data-dc-identify-image');
  });

  it('marks the landing page only after a successful artifact publish', async () => {
    const context = await contextWithAnalytics();
    const auth = new AuthService(context.db, context.config, context.logger);
    const account = await auth.createPasswordAccount('publisher@example.test', 'password123');
    const { bot } = await auth.createBot(accountToCloudAccount(account), 'Publishing bot');
    const artifacts = new ArtifactService({
      db: context.db,
      extension: createDefaultCloudModule(context.config),
      baseUrl: context.config.baseUrl,
      logger: context.logger,
    });
    const created = await artifacts.upsertArtifact({
      account: accountToCloudAccount(account),
      bot: { id: bot.id, name: bot.name, byline: bot.byline },
      slug: 'goal-proof',
      type: 'markdown',
      title: 'Goal proof',
      content: '# Private until the owner publishes it',
      share: false,
    });
    const cookie = await login(context, account.email, 'password123');
    const headers = originHeaders(context, cookie);
    headers.set('content-type', 'application/x-www-form-urlencoded');

    const published = await context.app.request(
      `/dashboard/api/artifacts/${created.artifact.id}/share`,
      { method: 'POST', headers, body: new URLSearchParams() }
    );
    expect(published.status).toBe(303);
    expect(published.headers.get('location')).toContain('notice=share_created');

    const landing = await context.app.request(published.headers.get('location') ?? '/', {
      headers: { Cookie: cookie },
    });
    expect(await landing.text()).toContain('data-dc-page-goal="artifact_published"');

    const ordinaryView = await context.app.request(`/dashboard/artifacts/${created.artifact.id}`, {
      headers: { Cookie: cookie },
    });
    expect(await ordinaryView.text()).not.toContain('data-dc-page-goal');
  });

  it('keeps magic-link identification quiet when analytics is off', async () => {
    const context = await createAuthTestContext();
    contexts.push(context);
    const auth = new AuthService(context.db, context.config, context.logger);
    const account = await auth.createPasswordAccount('quiet@example.test', 'password123');
    const issued = await auth.requestMagicLink(account.email);

    const verified = await context.app.request('/auth/verify', {
      method: 'POST',
      ...formBody({ token: issued.token ?? '' }),
    });
    expect(verified.headers.get('location')).toBe('/dashboard');

    const dashboard = await context.app.request('/dashboard', {
      headers: { Cookie: cookieFrom(verified) },
    });
    const html = await dashboard.text();
    expect(html).not.toContain('data-dc-identify-user');
    expect(html).not.toContain('databull.subscriptions-972.workers.dev');
  });
});
