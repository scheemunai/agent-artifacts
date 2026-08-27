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

async function signIn(ctx: AuthTestContext): Promise<string> {
  const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
  const account = await auth.createPasswordAccount('notice@example.test', 'password123');
  return login(ctx, account.email, 'password123');
}

async function createBot(
  ctx: AuthTestContext,
  cookie: string,
  name: string
): Promise<{ location: string; botId: string }> {
  const response = await ctx.app.request('/dashboard/api/bots', {
    method: 'POST',
    headers: postHeaders(ctx, cookie),
    body: formBody({ name }).body,
  });
  expect(response.status).toBe(303);
  const row = ctx.db.sqlite.prepare('SELECT id FROM bots WHERE name = ?').get(name) as {
    id: string;
  };
  return { location: response.headers.get('location') ?? '/dashboard/bots', botId: row.id };
}

describe('B-G5 · transient feedback is a Notice, not a Badge', () => {
  it('renders the page outcome through Notice and never as a status pill', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx);

    const html = await (
      await ctx.app.request('/dashboard?notice=artifact_deleted', { headers: { Cookie: cookie } })
    ).text();

    expect(html).toContain('data-aa-notice="success"');
    expect(html).toContain('data-aa-notice-page="true"');
    expect(html).toContain('Artifact deleted.');
    // A Badge is an inline status marker on the object whose state it describes. Page feedback
    // rendered as one put chrome and outcome in the same visual object.
    expect(html).not.toMatch(/<span class="aa-badge[^"]*">\s*Artifact deleted\./);
  });
});

describe('B-K1 / B-A6 · the revealed key carries its own outcome and names its bot', () => {
  it('creation reveals a card titled for the bot, above the form that made it', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx);
    const { location } = await createBot(ctx, cookie, 'Reveal Bot');

    const html = await (await ctx.app.request(location, { headers: { Cookie: cookie } })).text();

    expect(html).toContain('New key for Reveal Bot');
    expect(html).toContain('aa-card__notice');
    expect(html).toContain('data-aa-notice="success"');
    // Attached, so nothing is left floating at the top of the page saying the same thing.
    expect(html).not.toContain('data-aa-notice-page="true"');
    // Rung 3 of the attachment ladder: the outcome sits with the card, and the card is no longer
    // 780px below the form and the notice that announced it.
    expect(html.indexOf('New key for Reveal Bot')).toBeLessThan(
      html.indexOf('The key appears once after creation.')
    );
  });

  it('regeneration is visually distinct from creation and announced as a breaking change', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx);
    const { botId } = await createBot(ctx, cookie, 'Rolling Bot');

    const regenerated = await ctx.app.request(`/dashboard/api/bots/${botId}/regenerate`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'Rolling Bot' }).body,
    });
    expect(regenerated.status).toBe(303);
    const html = await (
      await ctx.app.request(regenerated.headers.get('location') ?? '/dashboard/bots', {
        headers: { Cookie: cookie },
      })
    ).text();

    expect(html).toContain('Regenerated key for Rolling Bot');
    expect(html).not.toContain('New key for Rolling Bot');
    // B-A5: a breaking, security-relevant outcome was painted success green.
    expect(html).toContain('data-aa-notice="warn"');
    expect(html).not.toContain('data-aa-notice="success"');
    expect(html).toMatch(/previous key for Rolling Bot/);
  });
});

describe('B-G7 / B-G8 · bot errors render where they happened', () => {
  it('a failed regenerate reports on its own row, not on the create-a-bot form', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx);
    const { botId } = await createBot(ctx, cookie, 'Target Bot');
    await createBot(ctx, cookie, 'Bystander Bot');

    const failed = await ctx.app.request(`/dashboard/api/bots/${botId}/regenerate`, {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ confirm: 'wrong name' }).body,
    });
    expect(failed.status).toBe(400);
    const html = await failed.text();

    const message = 'Type the bot name to confirm';
    expect(html).toContain(message);
    // The whole defect: this message used to render inside the New bot card at the top of the
    // page, describing a control several hundred pixels below it. So the assertion is spatial —
    // the message must live in the offending bot's own row and nowhere else on the page.
    expect(html.indexOf(message)).toBeGreaterThan(html.indexOf('Registered bots'));
    const rows = html.split('<tr>').filter((row) => row.includes('data-aa-open-dialog='));
    const owning = rows.filter((row) => row.includes(`regenerate-bot-${botId}-dialog`));
    expect(owning).toHaveLength(1);
    expect(owning[0]).toContain(message);
    expect(rows.filter((row) => row.includes(message))).toHaveLength(1);
    expect(html).not.toContain('id="name-error"');
  });

  it('a missing bot name marks the field, not the card', async () => {
    const ctx = await makeContext();
    const cookie = await signIn(ctx);

    const failed = await ctx.app.request('/dashboard/api/bots', {
      method: 'POST',
      headers: postHeaders(ctx, cookie),
      body: formBody({ name: '' }).body,
    });
    expect(failed.status).toBe(400);
    const html = await failed.text();

    expect(html).toContain('id="name-error"');
    expect(html).toMatch(/<input[^>]*id="name"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<input[^>]*id="name"[^>]*aria-describedby="name-error"/);
  });
});
