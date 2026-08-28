import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import { SESSION_COOKIE_NAME, SessionService } from '../../src/services/sessions.js';
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

function postHeaders(ctx: AuthTestContext, cookie: string): Headers {
  const headers = originHeaders(ctx, cookie);
  headers.set('Content-Type', 'application/x-www-form-urlencoded');
  return headers;
}

/** What an attacker would put in the URL if the page would print it. */
const PHISH = 'Your account is suspended. Call 555-0100 to restore access.';

async function signIn(ctx: AuthTestContext): Promise<{ cookie: string; email: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('keys@example.test', 'password123');
  return { cookie: await login(ctx, account.email, 'password123'), email: account.email };
}

async function cloudSession(ctx: AuthTestContext): Promise<string> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('cloud-keys@example.test', 'password123');
  const session = await new SessionService(ctx.db, ctx.config).createSession(account.id);
  return `${SESSION_COOKIE_NAME}=${session.cookieValue}`;
}

async function seedArtifact(
  ctx: AuthTestContext,
  type: 'markdown' | 'html'
): Promise<{ cookie: string; artifactId: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  // One account per artifact: the two promote refusals under test need two owners in one context.
  const account = await auth.createPasswordAccount(`promote-${type}@example.test`, 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Key Bot');
  const created = await new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  }).upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: `promote-keys-${type}`,
    type,
    title: 'Promote Keys',
    content: type === 'markdown' ? '# No slots here' : '<h1>No slots</h1>',
    share: false,
  });
  return {
    cookie: await login(ctx, account.email, 'password123'),
    artifactId: created.artifact.id,
  };
}

describe('the dashboard does not print what the URL tells it to', () => {
  it('refuses to render arbitrary text handed to the settings page', async () => {
    const ctx = await makeContext();
    const { cookie } = await signIn(ctx);

    const html = await (
      await ctx.app.request(`/dashboard/settings?error=${encodeURIComponent(PHISH)}`, {
        headers: { Cookie: cookie },
      })
    ).text();

    // A message read out of the query string is a message anyone can put on this page by sending
    // someone a link. The page's vocabulary has to be closed.
    expect(html).not.toContain('Your account is suspended');
    expect(html).not.toContain('555-0100');
  });

  it('refuses the same trick on the artifact page', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedArtifact(ctx, 'markdown');

    const html = await (
      await ctx.app.request(
        `/dashboard/artifacts/${artifactId}?promote_error=${encodeURIComponent(PHISH)}`,
        { headers: { Cookie: cookie } }
      )
    ).text();

    expect(html).not.toContain('Your account is suspended');
    expect(html).not.toContain('555-0100');
  });

  it('ignores a code it does not know rather than inventing a message', async () => {
    const ctx = await makeContext();
    const { cookie } = await signIn(ctx);

    const html = await (
      await ctx.app.request('/dashboard/settings?notice=not_a_real_key', {
        headers: { Cookie: cookie },
      })
    ).text();
    expect(html).not.toContain('aa-notice--danger');
  });
});

describe('the real failures keep their specific copy', () => {
  it('names a wrong current password on the email form', async () => {
    const ctx = await makeContext();
    const { cookie } = await signIn(ctx);

    const failed = await ctx.app.request('/dashboard/api/settings/email', {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ new_email: 'new@example.test', current_password: 'wrong' }).body,
    });

    expect(failed.status).toBe(303);
    const landing = failed.headers.get('location') ?? '';
    expect(landing).not.toContain('%20');
    const html = await (await ctx.app.request(landing, { headers: { Cookie: cookie } })).text();
    expect(html).toContain('current password');
  });

  it('tells apart a password mismatch from a password that is too short', async () => {
    const ctx = await makeContext();
    const { cookie } = await signIn(ctx);

    const mismatch = await ctx.app.request('/dashboard/api/settings/password', {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({
        current_password: 'password123',
        new_password: 'a-long-enough-one',
        confirm_password: 'a-different-one',
      }).body,
    });
    const short = await ctx.app.request('/dashboard/api/settings/password', {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({
        current_password: 'password123',
        new_password: 'short',
        confirm_password: 'short',
      }).body,
    });

    const mismatchLanding = mismatch.headers.get('location') ?? '';
    const shortLanding = short.headers.get('location') ?? '';
    expect(mismatchLanding).not.toBe(shortLanding);

    const mismatchHtml = await (
      await ctx.app.request(mismatchLanding, { headers: { Cookie: cookie } })
    ).text();
    const shortHtml = await (
      await ctx.app.request(shortLanding, { headers: { Cookie: cookie } })
    ).text();
    expect(mismatchHtml).toContain('do not match');
    expect(shortHtml).toContain('8 characters');
  });

  it('keeps the cloud password refusal specific', async () => {
    const ctx = await makeContext({ DEPLOYMENT: 'cloud' });
    const cookie = await cloudSession(ctx);

    const refused = await ctx.app.request('/dashboard/api/settings/password', {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({
        current_password: 'password123',
        new_password: 'a-long-enough-one',
        confirm_password: 'a-long-enough-one',
      }).body,
    });
    const landing = refused.headers.get('location') ?? '';
    const html = await (await ctx.app.request(landing, { headers: { Cookie: cookie } })).text();
    expect(html).toContain('cloud');
  });

  it('names the slug as the reason when the slug is what was wrong', async () => {
    // V10-N2. `promoteFailureCode` classified by regexing the error's MESSAGE — anything without
    // "slot" in it became `markdown_only` — so typing a malformed slug into a MARKDOWN artifact's
    // promote form answered "Only markdown artifacts can be promoted to templates."
    //
    // Three things wrong with that sentence at once: it is false about the artifact, it never names
    // the mistake the user actually made, and it appears on a panel that only renders for markdown
    // artifacts in the first place — so it contradicts the page it is printed on.
    const ctx = await makeContext();
    const markdown = await seedArtifact(ctx, 'markdown');

    const refused = await ctx.app.request(
      `/dashboard/api/artifacts/${markdown.artifactId}/promote-template`,
      {
        method: 'POST',
        headers: postHeaders(ctx, markdown.cookie),
        body: formBody({ name: 'Y', slug: 'BAD SLUG!!' }).body,
      }
    );

    const landing = refused.headers.get('location') ?? '';
    expect(landing, 'the slug refusal is not carried as its own cause').toContain(
      'promote_error=slug_invalid'
    );

    const html = await (
      await ctx.app.request(landing, { headers: { Cookie: markdown.cookie } })
    ).text();

    // The real cause, delivered to the field it belongs to rather than to a notice above the form.
    expect(html).toContain('Use lowercase letters, numbers and hyphens');
    expect(html).toContain('id="template_slug-error"');
    expect(html).toMatch(/id="template_slug"[^>]*aria-invalid="true"/);

    // And the false cause is gone. This is the assertion the defect was: a markdown artifact being
    // told it is not markdown.
    expect(
      html,
      'the form still blames the artifact type for a mistake in the slug field'
    ).not.toContain('Only markdown artifacts can be promoted to templates.');
  });

  it('keeps each promote refusal distinguishable', async () => {
    const ctx = await makeContext();
    const html = await seedArtifact(ctx, 'html');
    const markdown = await seedArtifact(ctx, 'markdown');

    const htmlRefused = await ctx.app.request(
      `/dashboard/api/artifacts/${html.artifactId}/promote-template`,
      {
        method: 'POST',
        headers: postHeaders(ctx, html.cookie),
        body: formBody({ name: 'X', slug: 'x-template' }).body,
      }
    );
    const slotless = await ctx.app.request(
      `/dashboard/api/artifacts/${markdown.artifactId}/promote-template`,
      {
        method: 'POST',
        headers: postHeaders(ctx, markdown.cookie),
        body: formBody({ name: 'Y', slug: 'y-template' }).body,
      }
    );

    const htmlLanding = htmlRefused.headers.get('location') ?? '';
    const slotlessLanding = slotless.headers.get('location') ?? '';
    expect(htmlLanding).not.toContain('%20');
    expect(htmlLanding).not.toBe(slotlessLanding);

    const slotlessHtml = await (
      await ctx.app.request(slotlessLanding, { headers: { Cookie: markdown.cookie } })
    ).text();
    expect(slotlessHtml).toContain('slot');
  });
});
