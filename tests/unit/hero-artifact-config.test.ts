import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToString } from 'hono/jsx/dom/server';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { type AppConfig, loadConfig } from '../../src/config.js';
import { createWebRoute } from '../../src/routes/web.js';
import {
  DEFAULT_HERO_ARTIFACT_PATH,
  heroArtifactPollUrl,
  heroArtifactUrl,
  resetLiveArtifactMeta,
  startLiveArtifactMetaRefresh,
} from '../../src/services/live-artifact-meta.js';
import { HOME_COMING_SOON_HERO, HOME_HERO, HomePage } from '../../src/ui/pages/home.js';

const logger = pino({ enabled: false });

afterEach(() => {
  resetLiveArtifactMeta();
});

function config(env: Record<string, string> = {}): AppConfig {
  const cwd = mkdtempSync(join(tmpdir(), 'aa-hero-'));
  try {
    return loadConfig(
      {
        DEPLOYMENT: 'cloud',
        BASE_URL: 'https://agentartifact.ai',
        DATABASE_URL: 'postgresql://aa@127.0.0.1:5432/aa',
        SESSION_SECRET: 'test-session-secret-with-at-least-32-bytes',
        SANDBOX_ORIGIN: 'https://sandbox.agentartifact.ai',
        AA_MAIL_TRANSPORT: 'log',
        AA_SQLITE_PATH: './data/app.db',
        LOG_LEVEL: 'error',
        ...env,
      },
      { cwd }
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * The hero artifact is an artifact ID — a row in one particular database — and it was hard-coded.
 * Every deployment that did not happen to be the one it was seeded on polled a 404 at boot and
 * again every fifteen minutes, and linked visitors to the same missing page.
 */
describe('AA_HERO_ARTIFACT_PATH', () => {
  it('defaults to the packaged demo artifact, so a stock deployment is unchanged', () => {
    expect(config().heroArtifactPath).toBe(DEFAULT_HERO_ARTIFACT_PATH);
    expect(heroArtifactUrl('https://agentartifact.ai', config().heroArtifactPath)).toBe(
      `https://agentartifact.ai${DEFAULT_HERO_ARTIFACT_PATH}`
    );
  });

  it('takes the path from the environment', () => {
    const custom = config({ AA_HERO_ARTIFACT_PATH: '/a/OwnHostArtifact123456' });

    expect(custom.heroArtifactPath).toBe('/a/OwnHostArtifact123456');
    expect(heroArtifactUrl('https://agentartifact.ai', custom.heroArtifactPath)).toBe(
      'https://agentartifact.ai/a/OwnHostArtifact123456'
    );
  });

  it('treats an empty value as "this host has no hero artifact", not as unset', () => {
    // The distinction is the whole point: falling back to the default here is what produced the
    // 404 in the first place.
    expect(config({ AA_HERO_ARTIFACT_PATH: '' }).heroArtifactPath).toBe('');
    expect(config({ AA_HERO_ARTIFACT_PATH: '   ' }).heroArtifactPath).toBe('');
    expect(heroArtifactUrl('https://agentartifact.ai', '')).toBeNull();
  });

  it('refuses a value that is not a path', () => {
    expect(() => config({ AA_HERO_ARTIFACT_PATH: 'https://elsewhere.test/a/abc' })).toThrow(
      /AA_HERO_ARTIFACT_PATH/
    );
  });
});

describe('deciding whether to poll the hero artifact', () => {
  it('polls on a launched cloud host with an artifact configured', () => {
    expect(heroArtifactPollUrl(config())).toBe(
      `https://agentartifact.ai${DEFAULT_HERO_ARTIFACT_PATH}`
    );
  });

  it('does not poll when the homepage is the coming-soon page', () => {
    // The coming-soon page never reads the snapshot, so filling it is pure noise — and on the one
    // host that is actually pre-launch, noise against an artifact that is not there.
    expect(heroArtifactPollUrl(config({ AA_COMING_SOON: 'true' }))).toBeNull();
  });

  it('does not poll when no hero artifact is configured', () => {
    expect(heroArtifactPollUrl(config({ AA_HERO_ARTIFACT_PATH: '' }))).toBeNull();
  });

  it('still does not poll on a self-hosted deployment', () => {
    const selfHosted = config({ DEPLOYMENT: 'self-hosted', BASE_URL: 'http://localhost:3000' });

    expect(heroArtifactPollUrl(selfHosted)).toBeNull();
  });
});

describe('the refresher with nothing to poll', () => {
  it('starts no timer and makes no request', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const refresher = startLiveArtifactMetaRefresh(null, { fetchImpl, intervalMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresher.stop();

    expect(calls).toBe(0);
  });

  it('still fetches when there is an artifact, so the guard is not just switching everything off', async () => {
    let calls = 0;
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ latest_version_num: 3, updated_at: new Date().toISOString() }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )) as unknown as typeof fetch;
    const counting = (async (...args: Parameters<typeof fetch>) => {
      calls += 1;
      return fetchImpl(...args);
    }) as unknown as typeof fetch;

    const refresher = startLiveArtifactMetaRefresh('https://agentartifact.ai/a/demo', {
      fetchImpl: counting,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresher.stop();

    expect(calls).toBe(1);
  });
});

describe('the homepage with no hero artifact', () => {
  it('renders the full marketing page and drops the link rather than pointing at a 404', () => {
    const withArtifact = renderToString(
      HomePage({ baseUrl: 'https://agentartifact.ai', liveArtifact: null })
    );
    const without = renderToString(
      HomePage({
        baseUrl: 'https://agentartifact.ai',
        heroArtifactUrl: null,
        liveArtifact: null,
      })
    );

    // The page is intact: same hero, same static meta strip, same call to action.
    expect(without).toContain(HOME_HERO);
    expect(without).toContain('aa-marketing-chip">v1');
    expect(without).toContain('published 3h ago');
    expect(without).toContain('href="/login?mode=magic"');
    expect(without.match(/<h1\b/g) ?? []).toHaveLength(1);

    // Only the dead link is gone.
    expect(withArtifact).toContain('>Live artifact</a>');
    expect(withArtifact).toContain(`https://agentartifact.ai${DEFAULT_HERO_ARTIFACT_PATH}`);
    expect(without).not.toContain('>Live artifact</a>');
    expect(without).not.toContain(DEFAULT_HERO_ARTIFACT_PATH);
  });

  it('drops it from the coming-soon face too', () => {
    const without = renderToString(
      HomePage({
        baseUrl: 'https://agentartifact.ai',
        comingSoon: true,
        heroArtifactUrl: null,
        waitlist: { enabled: true },
      })
    );

    expect(without).toContain(HOME_COMING_SOON_HERO);
    expect(without).not.toContain('>Live artifact</a>');
    expect(without).not.toContain(DEFAULT_HERO_ARTIFACT_PATH);
  });

  it('keeps the link when the deployment does have one', () => {
    const rendered = renderToString(
      HomePage({
        baseUrl: 'https://agentartifact.ai',
        heroArtifactUrl: 'https://agentartifact.ai/a/OwnHostArtifact123456',
        liveArtifact: null,
      })
    );

    expect(rendered).toContain('href="https://agentartifact.ai/a/OwnHostArtifact123456"');
    expect(rendered).toContain('>Live artifact</a>');
  });
});

describe('the web route wires the configured path through', () => {
  it('serves the marketing homepage with no hero link when the path is empty', async () => {
    const empty = config({ AA_HERO_ARTIFACT_PATH: '' });
    const response = await createWebRoute(empty, logger).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(HOME_HERO);
    expect(html).not.toContain('>Live artifact</a>');
    expect(html).not.toContain(DEFAULT_HERO_ARTIFACT_PATH);
  });

  it('serves it with the hero link when the path is set', async () => {
    const response = await createWebRoute(config(), logger).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(`https://agentartifact.ai${DEFAULT_HERO_ARTIFACT_PATH}`);
    expect(html).toContain('>Live artifact</a>');
  });
});
