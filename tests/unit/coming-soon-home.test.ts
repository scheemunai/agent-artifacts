import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToString } from 'hono/jsx/dom/server';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createWebRoute } from '../../src/routes/web.js';
import { WaitlistError, type WaitlistService } from '../../src/services/waitlist.js';
import {
  HOME_COMING_SOON_HERO,
  HOME_COMING_SOON_JOINED_TITLE,
  HOME_COMING_SOON_SUBLINE,
  HOME_HERO,
  HomePage,
} from '../../src/ui/pages/home.js';

const BASE = 'https://agentartifact.ai';
const logger = pino({ enabled: false });

const render = (props: Parameters<typeof HomePage>[0]) => renderToString(HomePage(props));

/** A waitlist that never leaves the process. `enabled` and the outcome are the only knobs. */
function stubWaitlist(
  behaviour: { enabled?: boolean; fail?: WaitlistError } = {}
): WaitlistService & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    enabled: behaviour.enabled ?? true,
    async subscribe(email: string) {
      seen.push(email);
      if (behaviour.fail) {
        throw behaviour.fail;
      }
      return 'subscribed';
    },
  };
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'aa-coming-soon-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function testConfig(env: Record<string, string> = {}) {
  return loadConfig(
    {
      DEPLOYMENT: 'self-hosted',
      BASE_URL: BASE,
      AA_SQLITE_PATH: './data/app.db',
      ...env,
    },
    { cwd }
  );
}

describe('the coming-soon homepage is a variant of the marketing one', () => {
  it('renders the full marketing homepage while the flag is off', () => {
    const html = render({ baseUrl: BASE });

    expect(html).toContain(HOME_HERO);
    expect(html).toContain('What people use it for');
    expect(html).toContain('Start free. Keep what matters.');
    expect(html).not.toContain(HOME_COMING_SOON_HERO);
    expect(html).not.toContain('action="/waitlist"');
  });

  it('keeps the brand, the hero card and the works-with strip when the flag is on', () => {
    const html = render({ baseUrl: BASE, comingSoon: true, waitlist: { enabled: true } });

    // The chrome that makes it the same site rather than a placeholder someone hand-rolled.
    expect(html).toContain('aa-marketing-hero-card');
    expect(html).toContain('Agent Artifacts home');
    expect(html).toContain('Versioning:');
    expect(html).toContain('Claude Code');
    expect(html).toContain(HOME_COMING_SOON_HERO);
    expect(html).toContain(HOME_COMING_SOON_SUBLINE);
    // Exactly one h1, on every state of the page.
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
  });

  it('drops the sections a pre-launch page cannot honour', () => {
    const html = render({ baseUrl: BASE, comingSoon: true, waitlist: { enabled: true } });

    // Pricing quotes terms nobody can buy yet and the examples link to artifacts nobody can make.
    expect(html).not.toContain('Start free. Keep what matters.');
    expect(html).not.toContain('Most popular');
    expect(html).not.toContain('What people use it for');
    // And no "Get started", which is the claim the whole page exists to withdraw.
    expect(html).not.toContain('Get started');
  });

  it('serves a real form with a labelled email field and a submit button', () => {
    const html = render({ baseUrl: BASE, comingSoon: true, waitlist: { enabled: true } });

    expect(html).toContain('action="/waitlist"');
    expect(html).toContain('method="post"');
    expect(html).toContain('type="email"');
    expect(html).toContain('name="email"');
    expect(html).toContain('required');
    expect(html).toContain('Notify me');
    // The label is a real label bound to the field, not a placeholder standing in for one.
    expect(html).toMatch(/<label[^>]*for="waitlist-email"/);
  });

  it('confirms the signup by naming the address it was given', () => {
    const html = render({
      baseUrl: BASE,
      comingSoon: true,
      waitlist: { enabled: true, state: 'joined', email: 'ada@example.test' },
    });

    expect(html).toContain(HOME_COMING_SOON_JOINED_TITLE);
    expect(html).toContain('ada@example.test');
    // The form is gone: there is nothing left to submit.
    expect(html).not.toContain('action="/waitlist"');
    expect(html.match(/<h1\b/g) ?? []).toHaveLength(1);
  });

  it('puts a rejection on the field and gives back what was typed', () => {
    const html = render({
      baseUrl: BASE,
      comingSoon: true,
      waitlist: {
        enabled: true,
        state: 'error',
        email: 'not-an-email',
        error: 'That does not look like an email address.',
      },
    });

    expect(html).toContain('That does not look like an email address.');
    expect(html).toContain('value="not-an-email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('action="/waitlist"');
  });

  it('shows a mail address instead of a form when no audience is wired up', () => {
    const html = render({ baseUrl: BASE, comingSoon: true, waitlist: { enabled: false } });

    // A box that collects addresses it has nowhere to put is worse than no box.
    expect(html).not.toContain('action="/waitlist"');
    expect(html).toContain('mailto:hello@agentartifact.ai');
  });
});

describe('the flag decides which homepage the route serves', () => {
  it('serves the marketing homepage, unchanged, while the flag is off', async () => {
    const config = { ...testConfig(), deployment: 'cloud' as const };
    const web = createWebRoute(config, logger, { waitlist: stubWaitlist() });
    const response = await web.request(`${BASE}/`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(HOME_HERO);
    expect(html).not.toContain(HOME_COMING_SOON_HERO);
  });

  it('serves the coming-soon page when the flag is on, whatever the deployment mode is', async () => {
    // Self-hosted normally redirects `/` to setup. The flag is an explicit statement about this
    // host's front door and outranks that, or it would be unusable on the deployment that has one.
    const web = createWebRoute(testConfig({ AA_COMING_SOON: 'true' }), logger, {
      waitlist: stubWaitlist(),
    });
    const response = await web.request(`${BASE}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(HOME_COMING_SOON_HERO);
  });

  it('redirects a GET of the form action back to the page that holds the form', async () => {
    const web = createWebRoute(testConfig({ AA_COMING_SOON: 'true' }), logger, {
      waitlist: stubWaitlist(),
    });
    const response = await web.request(`${BASE}/waitlist`);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
  });

  it('does not mount the waitlist route at all once the flag is off', async () => {
    // Otherwise a POST at a launched site renders "launching soon" to whoever asked for it — a
    // route that belongs to the pre-launch page should not outlive the page.
    const web = createWebRoute(testConfig(), logger, { waitlist: stubWaitlist() });

    expect((await web.request(`${BASE}/waitlist`)).status).toBe(404);
    expect(
      (
        await web.request(`${BASE}/waitlist`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'email=ada@example.test',
        })
      ).status
    ).toBe(404);
    // The routes that are not the waitlist's survive the early return.
    expect((await web.request(`${BASE}/style-guide`)).status).toBe(200);
  });
});

describe('POST /waitlist', () => {
  const post = (config: ReturnType<typeof testConfig>, service: WaitlistService, email: string) =>
    createWebRoute(config, logger, { waitlist: service }).request(`${BASE}/waitlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email }).toString(),
    });

  it('subscribes the address and answers with the confirmation state', async () => {
    const service = stubWaitlist();
    const response = await post(
      testConfig({ AA_COMING_SOON: 'true' }),
      service,
      'ada@example.test'
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(service.seen).toEqual(['ada@example.test']);
    expect(html).toContain(HOME_COMING_SOON_JOINED_TITLE);
    expect(html).toContain('ada@example.test');
  });

  it('answers 400 and re-serves the form when the address is rejected', async () => {
    const service = stubWaitlist({
      fail: new WaitlistError('invalid_email', 'That does not look like an email address.'),
    });
    const response = await post(testConfig({ AA_COMING_SOON: 'true' }), service, 'nope');
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain('That does not look like an email address.');
    expect(html).toContain('value="nope"');
  });

  it('answers 503 and says so plainly when the audience cannot be reached', async () => {
    const service = stubWaitlist({ fail: new WaitlistError('upstream', 'nope') });
    const response = await post(
      testConfig({ AA_COMING_SOON: 'true' }),
      service,
      'ada@example.test'
    );
    const html = await response.text();

    expect(response.status).toBe(503);
    // The visitor is told to try again, not told they are on a list they are not on.
    expect(html).toContain('Try again in a moment.');
    expect(html).not.toContain(HOME_COMING_SOON_JOINED_TITLE);
  });

  it('rate-limits repeated submissions of the same address', async () => {
    const config = testConfig({ AA_COMING_SOON: 'true' });
    const service = stubWaitlist();
    const web = createWebRoute(config, logger, { waitlist: service });
    const submit = () =>
      web.request(`${BASE}/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: 'flood@example.test' }).toString(),
      });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      statuses.push((await submit()).status);
    }

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(service.seen).toHaveLength(5);
  });
});
