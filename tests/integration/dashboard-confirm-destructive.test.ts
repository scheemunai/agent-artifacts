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

function postHeaders(ctx: AuthTestContext, cookie: string): Headers {
  const headers = originHeaders(ctx, cookie);
  headers.set('Content-Type', 'application/x-www-form-urlencoded');
  return headers;
}

/**
 * Every text input that is live at rest — i.e. not parked inside a closed `<dialog>`.
 *
 * This is the measurement behind B-D1. Counting `<input>` tags alone cannot tell an always-open
 * type-to-confirm form from a confirmation the reader has to deliberately open, and the whole
 * defect was that the bots registry shipped eight of the former.
 */
function inputsOutsideDialogs(html: string): string[] {
  const withoutDialogs = html.replace(/<dialog[\s\S]*?<\/dialog>/g, '');
  return withoutDialogs.match(/<input\b[^>]*>/g) ?? [];
}

async function seedBots(
  ctx: AuthTestContext,
  names: string[]
): Promise<{ cookie: string; botIds: Record<string, string> }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('confirm@example.test', 'password123');
  const botIds: Record<string, string> = {};
  for (const name of names) {
    const { bot } = await auth.createBot(accountToCloudAccount(account), name, `${name} byline`);
    botIds[name] = bot.id;
  }
  return { cookie: await login(ctx, account.email, 'password123'), botIds };
}

async function seedArtifact(
  ctx: AuthTestContext,
  options: { share?: boolean } = {}
): Promise<{ cookie: string; artifactId: string; email: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('destructive@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'Confirm Bot');
  const artifacts = new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  });
  const created = await artifacts.upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'confirm-target',
    type: 'markdown',
    title: 'Confirm Target',
    content: '# Confirm Target',
    share: options.share ?? false,
  });
  return {
    cookie: await login(ctx, account.email, 'password123'),
    artifactId: created.artifact.id,
    email: account.email,
  };
}

describe('B-D1 · destructive actions are dialogs, not always-open forms', () => {
  it('a four-bot registry carries zero live destructive inputs at rest', async () => {
    const ctx = await makeContext();
    const { cookie, botIds } = await seedBots(ctx, ['Alpha', 'Bravo', 'Charlie', 'Delta']);

    const response = await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } });
    const html = await response.text();
    expect(response.status).toBe(200);

    // Before this fix the same page shipped eight live confirm inputs, two per row.
    const live = inputsOutsideDialogs(html);
    expect(live.filter((input) => /name="confirm/.test(input))).toEqual([]);

    for (const [name, id] of Object.entries(botIds)) {
      expect(html, name).toContain(`data-aa-open-dialog="regenerate-bot-${id}-dialog"`);
      expect(html, name).toContain(`data-aa-open-dialog="revoke-bot-${id}-dialog"`);
      expect(html, name).toContain(`data-aa-confirm-match="${name}"`);
    }
    expect(html.match(/<dialog\b/g) ?? []).toHaveLength(8);
  });

  it('artifact delete and share revoke both open a typed confirmation instead of sitting open', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedArtifact(ctx, { share: true });

    const response = await ctx.app.request(`/dashboard/artifacts/${artifactId}`, {
      headers: { Cookie: cookie },
    });
    const html = await response.text();
    expect(response.status).toBe(200);

    expect(inputsOutsideDialogs(html).filter((input) => /name="confirm"/.test(input))).toEqual([]);
    expect(html).toContain(`data-aa-open-dialog="delete-artifact-${artifactId}-dialog"`);
    expect(html).toContain(`data-aa-open-dialog="revoke-share-${artifactId}-dialog"`);
    expect(html).toContain('data-aa-confirm-match="Confirm Target"');
    expect(html).toContain('data-aa-confirm-match="confirm-target"');
    expect(html).toContain('This cannot be undone');
  });

  it('account deletion is a typed confirmation dialog on the settings page', async () => {
    const ctx = await makeContext();
    const { cookie, email } = await seedArtifact(ctx);

    const response = await ctx.app.request('/dashboard/settings', { headers: { Cookie: cookie } });
    const html = await response.text();
    expect(response.status).toBe(200);

    expect(inputsOutsideDialogs(html).filter((input) => /name="confirm"/.test(input))).toEqual([]);
    expect(html).toContain('data-aa-open-dialog="delete-account-dialog"');
    expect(html).toContain(`data-aa-confirm-match="${email}"`);
  });
});

describe('B-D1 · the server still owns the confirmation it renders', () => {
  it('deletes only when the typed title matches, and reports a mismatch otherwise', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedArtifact(ctx);

    const mismatch = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/delete`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'not the title' }).body,
    });
    expect(mismatch.status).toBe(303);
    // Each confirmation site names itself now (B-G6); one shared string could not say which of
    // the three on a page had failed.
    expect(mismatch.headers.get('location')).toContain('notice=delete_confirm_mismatch');

    const deleted = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/delete`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'Confirm Target' }).body,
    });
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get('location')).toBe('/dashboard?notice=artifact_deleted');
  });

  it('bot regenerate and revoke read the same confirm field the dialog posts', async () => {
    const ctx = await makeContext();
    const { cookie, botIds } = await seedBots(ctx, ['Alpha', 'Bravo']);

    const wrong = await ctx.app.request(`/dashboard/api/bots/${botIds.Alpha}/regenerate`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'Bravo' }).body,
    });
    // A rejected confirmation answers with somewhere to go, not with a document on the POST URL
    // that a refresh would re-submit (V2-N4). The server rejecting it is what is under test here,
    // and it still does.
    expect(wrong.status).toBe(303);
    expect(wrong.headers.get('location')).toContain('/dashboard/bots?bot_error=');

    const regenerated = await ctx.app.request(`/dashboard/api/bots/${botIds.Alpha}/regenerate`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'Alpha' }).body,
    });
    expect(regenerated.status).toBe(303);

    const revoked = await ctx.app.request(`/dashboard/api/bots/${botIds.Bravo}/revoke`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'Bravo' }).body,
    });
    expect(revoked.status).toBe(303);
    expect(revoked.headers.get('location')).toBe('/dashboard/bots?notice=bot_revoked');
  });

  it('account delete reads the same confirm field the dialog posts', async () => {
    const ctx = await makeContext();
    const { cookie, email } = await seedArtifact(ctx);

    const wrong = await ctx.app.request('/dashboard/api/settings/delete', {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'someone@else.test' }).body,
    });
    expect(wrong.status).toBe(303);
    expect(wrong.headers.get('location')).toContain('notice=account_confirm_mismatch');

    const deleted = await ctx.app.request('/dashboard/api/settings/delete', {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: email }).body,
    });
    expect(deleted.status).toBe(303);
    expect(deleted.headers.get('location')).toBe('/login');
  });
});

describe('B-D5 · a revoked bot offers no controls that cannot do anything', () => {
  it('drops both triggers for a revoked row and says why', async () => {
    const ctx = await makeContext();
    const { cookie, botIds } = await seedBots(ctx, ['Live', 'Dead']);

    const revoked = await ctx.app.request(`/dashboard/api/bots/${botIds.Dead}/revoke`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'Dead' }).body,
    });
    expect(revoked.status).toBe(303);

    const html = await (
      await ctx.app.request('/dashboard/bots', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain(`data-aa-open-dialog="regenerate-bot-${botIds.Live}-dialog"`);
    expect(html).toContain(`data-aa-open-dialog="revoke-bot-${botIds.Live}-dialog"`);
    expect(html).not.toContain(`data-aa-open-dialog="regenerate-bot-${botIds.Dead}-dialog"`);
    expect(html).not.toContain(`data-aa-open-dialog="revoke-bot-${botIds.Dead}-dialog"`);
    expect(html).toContain('This key was revoked');
  });
});
