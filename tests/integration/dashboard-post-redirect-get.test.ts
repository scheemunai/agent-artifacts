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
 * The shape that makes a refresh safe.
 *
 * A mutation that answers with a document leaves the browser standing on the POST URL, so the
 * reader's next reflex — refresh, or back-then-forward — re-submits it. For a destructive action
 * whose typed confirmation was correct and whose failure was transient, that reflex completes the
 * thing they just watched fail. The only safe answer to a POST is somewhere else to be.
 */
async function expectRedirectToPage(response: Response, pathPrefix: string): Promise<string> {
  const body = await response.clone().text();
  expect(response.status, `answered ${response.status} with a body of ${body.length} bytes`).toBe(
    303
  );
  const location = response.headers.get('location') ?? '';
  expect(location).toMatch(new RegExp(`^${pathPrefix}`));
  expect(location).not.toContain('/dashboard/api/');
  expect(body).not.toContain('<!doctype html');
  return location;
}

async function seedBots(
  ctx: AuthTestContext,
  names: string[]
): Promise<{ cookie: string; ids: Record<string, string> }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('prg@example.test', 'password123');
  const ids: Record<string, string> = {};
  for (const name of names) {
    const { bot } = await auth.createBot(accountToCloudAccount(account), name);
    ids[name] = bot.id;
  }
  return { cookie: await login(ctx, account.email, 'password123'), ids };
}

async function seedArtifact(
  ctx: AuthTestContext
): Promise<{ cookie: string; artifactId: string; email: string }> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('prg-artifact@example.test', 'password123');
  const { bot } = await auth.createBot(accountToCloudAccount(account), 'PRG Bot');
  const created = await new ArtifactService({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    baseUrl: ctx.config.baseUrl,
  }).upsertArtifact({
    account: accountToCloudAccount(account),
    bot: { id: bot.id, name: bot.name, byline: bot.byline },
    slug: 'prg-target',
    type: 'markdown',
    title: 'PRG Target',
    content: '# PRG Target',
    share: true,
  });
  return {
    cookie: await login(ctx, account.email, 'password123'),
    artifactId: created.artifact.id,
    email: account.email,
  };
}

/** The seeded id, or a failure that names the missing fixture rather than an undefined index. */
function requireId(ids: Record<string, string>, name: string): string {
  const id = ids[name];
  if (!id) {
    throw new Error(`no seeded bot named ${name}`);
  }
  return id;
}

function botRevokedAt(ctx: AuthTestContext, botId: string): number | null {
  const row = ctx.db.sqlite.prepare('SELECT revoked_at FROM bots WHERE id = ?').get(botId) as
    | { revoked_at: number | null }
    | undefined;
  return row?.revoked_at ?? null;
}

describe('V2-N4 · a failed destructive action does not leave a loaded gun in the address bar', () => {
  it('answers a mismatched bot revoke with somewhere to go, not a document', async () => {
    const ctx = await makeContext();
    const { cookie, ids } = await seedBots(ctx, ['Keeper']);

    const failed = await ctx.app.request(`/dashboard/api/bots/${ids.Keeper}/revoke`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'wrong name' }).body,
    });

    await expectRedirectToPage(failed, '/dashboard/bots');
    expect(botRevokedAt(ctx, requireId(ids, 'Keeper'))).toBeNull();
  });

  it('leaves the reader on a URL whose refresh mutates nothing', async () => {
    const ctx = await makeContext();
    const { cookie, ids } = await seedBots(ctx, ['Keeper']);

    const failed = await ctx.app.request(`/dashboard/api/bots/${ids.Keeper}/revoke`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'wrong name' }).body,
    });
    const landing = await expectRedirectToPage(failed, '/dashboard/bots');

    // The refresh. Twice, because a reader who does not understand what happened does it twice.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refreshed = await ctx.app.request(landing, { headers: { Cookie: cookie } });
      expect(refreshed.status).toBe(200);
      expect(
        botRevokedAt(ctx, requireId(ids, 'Keeper')),
        `after refresh ${attempt + 1}`
      ).toBeNull();
    }
  });

  it('carries the failure to the row it belongs to, through the redirect', async () => {
    const ctx = await makeContext();
    const { cookie, ids } = await seedBots(ctx, ['Target', 'Bystander']);

    const failed = await ctx.app.request(`/dashboard/api/bots/${ids.Target}/regenerate`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'wrong name' }).body,
    });
    const landing = await expectRedirectToPage(failed, '/dashboard/bots');
    const html = await (await ctx.app.request(landing, { headers: { Cookie: cookie } })).text();

    const rows = html.split('<tr>').filter((row) => row.includes('data-aa-open-dialog='));
    const owning = rows.filter((row) => row.includes(`regenerate-bot-${ids.Target}-dialog`));
    expect(owning).toHaveLength(1);
    expect(owning[0]).toContain('aa-notice--danger');
    expect(rows.filter((row) => row.includes('aa-notice--danger'))).toHaveLength(1);
    // Still not the create form's problem.
    expect(html).not.toContain('id="name-error"');
  });

  it('redirects the create form too, and keeps the failure on the field', async () => {
    const ctx = await makeContext();
    const { cookie } = await seedBots(ctx, []);

    const failed = await ctx.app.request('/dashboard/api/bots', {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ name: '' }).body,
    });
    const landing = await expectRedirectToPage(failed, '/dashboard/bots');
    const html = await (await ctx.app.request(landing, { headers: { Cookie: cookie } })).text();

    expect(html).toContain('id="name-error"');
    expect(html).toMatch(/<input[^>]*id="name"[^>]*aria-invalid="true"/);
  });
});

describe('V2-N4 · the transient branch, which is the one that can replay', () => {
  it('redirects when a restore names a version that is not there', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedArtifact(ctx);

    const failed = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/restore`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ version: '999' }).body,
    });

    await expectRedirectToPage(failed, `/dashboard/artifacts/${artifactId}`);
  });

  it('redirects when a delete is asked for an artifact that is already gone', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedArtifact(ctx);

    const first = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/delete`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'PRG Target' }).body,
    });
    expect(first.status).toBe(303);

    const replay = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/delete`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'PRG Target' }).body,
    });
    await expectRedirectToPage(replay, '/dashboard');
  });
});

describe('B-G6 · three confirmations that fail no longer say the same sentence', () => {
  it('names what failed, per site', async () => {
    const ctx = await makeContext();
    const { cookie, artifactId } = await seedArtifact(ctx);

    const deleteFailed = await ctx.app.request(`/dashboard/api/artifacts/${artifactId}/delete`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'not the title' }).body,
    });
    const revokeFailed = await ctx.app.request(
      `/dashboard/api/artifacts/${artifactId}/share/revoke`,
      {
        method: 'POST',
        headers: postHeaders(ctx, cookie),
        body: formBody({ confirm: 'not the slug' }).body,
      }
    );

    const deleteLanding = await expectRedirectToPage(deleteFailed, '/dashboard/artifacts/');
    const revokeLanding = await expectRedirectToPage(revokeFailed, '/dashboard/artifacts/');
    expect(deleteLanding).not.toBe(revokeLanding);

    const deleteHtml = await (
      await ctx.app.request(deleteLanding, { headers: { Cookie: cookie } })
    ).text();
    const revokeHtml = await (
      await ctx.app.request(revokeLanding, { headers: { Cookie: cookie } })
    ).text();

    expect(deleteHtml).toContain('was not deleted');
    expect(revokeHtml).toContain('is still live');
    // The shared "Typed confirmation did not match." is what made three failures indistinguishable.
    expect(deleteHtml).not.toContain('Typed confirmation did not match.');
    expect(revokeHtml).not.toContain('Typed confirmation did not match.');
  });
});
