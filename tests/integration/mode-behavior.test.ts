import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { type AppConfig, ConfigError, loadConfig } from '../../src/config.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Account, CloudModule } from '../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { skillText } from '../../src/routes/skill.js';
import { AnalyticsRecorder } from '../../src/services/analytics.js';
import { HOME_HERO, HOME_REPO_URL, HOME_SUBLINE } from '../../src/ui/pages/home.js';
import { insertAccount } from '../unit/db-test-utils.js';
import {
  createTestCloudModule,
  publishSharedArtifact,
  testPlan,
  type ViewerTestContext,
} from './viewer/viewer-test-utils.js';

const TEST_SESSION_SECRET = 'test-session-secret-with-at-least-32-bytes';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

describe('deployment mode behavior', () => {
  it('routes self-hosted root to setup before accounts exist and login after first account', async () => {
    const ctx = await createModeContext({
      env: { DEPLOYMENT: 'self-hosted' },
      insertAccount: false,
    });

    const firstBoot = await ctx.app.request('https://agentartifact.example.test/');
    expect(firstBoot.status).toBe(302);
    expect(firstBoot.headers.get('location')).toBe('/setup');

    insertAccount(ctx.db, ctx.account);

    const afterSetup = await ctx.app.request('https://agentartifact.example.test/');
    expect(afterSetup.status).toBe(302);
    expect(afterSetup.headers.get('location')).toBe('/login');
  });

  it('serves the static marketing homepage at root in cloud mode', async () => {
    const ctx = await createModeContext({ env: { DEPLOYMENT: 'cloud' } });

    const response = await ctx.app.request('https://agentartifact-cloud.example.test/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(HOME_HERO);
    expect(html).toContain(HOME_SUBLINE);
    expect(html).toContain('example-artifact');
    expect(html).toContain('href="/skill.md"');
    expect(html).toContain('What people use it for');
    expect(html).toContain('No card. Publish in a minute.');
    expect(html).toContain(`href="${HOME_REPO_URL}"`);
  });

  it('shows the GitHub affordances once AA_GITHUB_URL is configured', async () => {
    const githubUrl = 'https://github.com/example-owner/agent-artifacts';
    const ctx = await createModeContext({
      env: { DEPLOYMENT: 'cloud', AA_GITHUB_URL: githubUrl },
    });

    const response = await ctx.app.request('https://agentartifact-cloud.example.test/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(`href="${githubUrl}"`);
    expect(html).toContain('View on GitHub');
    expect(html).toContain('>GitHub<');
  });

  it('serves /skill.md in both deployment modes', async () => {
    const selfHosted = await createModeContext({ env: { DEPLOYMENT: 'self-hosted' } });
    const cloud = await createModeContext({ env: { DEPLOYMENT: 'cloud' } });

    for (const ctx of [selfHosted, cloud]) {
      const response = await ctx.app.request(`${ctx.config.baseUrl}/skill.md`);
      const text = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
      expect(text).toContain(`# Agent Artifacts Skill`);
      expect(text).toContain(`Base URL: ${ctx.config.baseUrl}/v1`);
      expect(text).toContain('Authorization: Bearer aa_bot_YOUR_KEY');
      expect(text).not.toMatch(/search/i);
    }
  });

  it('BYTE-PIN: an agent that sends no Accept gets exactly skillText, unaltered', async () => {
    const ctx = await createModeContext({ env: { DEPLOYMENT: 'cloud' } });

    const response = await ctx.app.request(`${ctx.config.baseUrl}/skill.md`);

    // Byte-for-byte against the source of truth. The human HTML branch may change freely; if it
    // ever moves this, the contract moved, and that must be a deliberate edit to skillText.
    expect(await response.text()).toBe(skillText(ctx.config));
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  });

  it('keeps the markdown byte-identical for a curl-style Accept', async () => {
    const ctx = await createModeContext({ env: { DEPLOYMENT: 'cloud' } });

    for (const accept of ['*/*', 'text/markdown', 'application/json', 'text/plain']) {
      const response = await ctx.app.request(`${ctx.config.baseUrl}/skill.md`, {
        headers: { Accept: accept },
      });

      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
      expect(await response.text()).toBe(skillText(ctx.config));
    }
  });

  it('answers a browser navigation with a rendered page instead of raw markdown', async () => {
    const ctx = await createModeContext({ env: { DEPLOYMENT: 'cloud' } });

    const response = await ctx.app.request(`${ctx.config.baseUrl}/skill.md`, {
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    });
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(html.toLowerCase().startsWith('<!doctype')).toBe(true);
    expect(html).toContain('aa-prose-page');
    expect(html).toContain('Authorization: Bearer aa_bot_YOUR_KEY');
    // Rendered, not dumped.
    expect(html).not.toContain('# Agent Artifacts Skill');
  });

  it('fails cloud boot without a real or dev mail transport and accepts AA_MAIL_TRANSPORT=log', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'aa-mode-config-'));
    cleanups.push(async () => rmSync(cwd, { recursive: true, force: true }));

    expect(() =>
      loadConfig(
        {
          DEPLOYMENT: 'cloud',
          BASE_URL: 'https://agentartifact-cloud.example.test',
          AA_SQLITE_PATH: './data/app.db',
          SESSION_SECRET: TEST_SESSION_SECRET,
          SANDBOX_ORIGIN: 'https://usercontent.example.test',
        },
        { cwd }
      )
    ).toThrow(ConfigError);

    expect(() =>
      loadConfig(
        {
          DEPLOYMENT: 'cloud',
          BASE_URL: 'https://agentartifact-cloud.example.test',
          AA_SQLITE_PATH: './data/app.db',
          SESSION_SECRET: TEST_SESSION_SECRET,
          SANDBOX_ORIGIN: 'https://usercontent.example.test',
        },
        { cwd }
      )
    ).toThrow(/AA_MAIL_TRANSPORT=log/);

    const config = loadConfig(
      {
        DEPLOYMENT: 'cloud',
        BASE_URL: 'https://agentartifact-cloud.example.test',
        AA_SQLITE_PATH: './data/app.db',
        SESSION_SECRET: TEST_SESSION_SECRET,
        SANDBOX_ORIGIN: 'https://usercontent.example.test',
        AA_MAIL_TRANSPORT: 'log',
      },
      { cwd }
    );
    expect(config.mail.transport).toBe('log');
  });

  it('shows the public artifact footer by default in self-hosted mode', async () => {
    const ctx = await createModeContext({ env: { DEPLOYMENT: 'self-hosted' } });
    const published = await publishSharedArtifact(ctx);

    const response = await ctx.app.request(`/a/${published.share?.shareId}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    // The mark is the ProductMark component now, not a text glyph, so the footer is
    // identified by its brand link rather than by the character it used to print.
    expect(html).toContain('aa-viewer-footer__brand');
  });

  it('suppresses the public footer with AA_HIDE_FOOTER in self-hosted mode', async () => {
    const ctx = await createModeContext({
      env: { DEPLOYMENT: 'self-hosted', AA_HIDE_FOOTER: 'true' },
    });
    const published = await publishSharedArtifact(ctx);

    const response = await ctx.app.request(`/a/${published.share?.shareId}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    // Branding off means no footer ELEMENT, not an empty one: the shell used to render
    // regardless and left a blank white bar under the artifact.
    expect(html).not.toContain('aa-viewer-footer__brand');
    expect(html).not.toContain('aa-viewer-footer');
  });

  it('uses the cloud plan hook to keep or remove the public footer in cloud mode', async () => {
    const free = await createModeContext({
      env: { DEPLOYMENT: 'cloud' },
      cloudModule: createTestCloudModule(testPlan({ id: 'free', name: 'Free', showFooter: true })),
    });
    const freeArtifact = await publishSharedArtifact(free);
    const freeHtml = await (await free.app.request(`/a/${freeArtifact.share?.shareId}`)).text();
    expect(freeHtml).toContain('aa-viewer-footer__brand');

    const pro = await createModeContext({
      env: { DEPLOYMENT: 'cloud' },
      cloudModule: createTestCloudModule(testPlan({ id: 'pro', name: 'Pro', showFooter: false })),
    });
    const proArtifact = await publishSharedArtifact(pro);
    const proHtml = await (await pro.app.request(`/a/${proArtifact.share?.shareId}`)).text();
    expect(proHtml).not.toContain('aa-viewer-footer__brand');
    expect(proHtml).not.toContain('aa-viewer-footer');
  });
});

async function createModeContext({
  env,
  cloudModule,
  insertAccount: shouldInsertAccount = true,
}: {
  env: Record<string, string>;
  cloudModule?: CloudModule | undefined;
  insertAccount?: boolean | undefined;
}): Promise<ViewerTestContext> {
  const cwd = mkdtempSync(join(tmpdir(), 'aa-mode-'));
  const deployment = env.DEPLOYMENT ?? 'self-hosted';
  const logger = pino({ enabled: false });
  const config = loadConfig(
    {
      DEPLOYMENT: deployment,
      BASE_URL:
        deployment === 'cloud'
          ? 'https://agentartifact-cloud.example.test'
          : 'https://agentartifact.example.test',
      AA_SQLITE_PATH: './data/app.db',
      AA_RATE_LIMITS_DISABLED: 'true',
      LOG_LEVEL: 'error',
      ...(deployment === 'cloud'
        ? {
            SESSION_SECRET: TEST_SESSION_SECRET,
            SANDBOX_ORIGIN: 'https://usercontent.example.test',
            AA_MAIL_TRANSPORT: 'log',
          }
        : {}),
      ...env,
    },
    { cwd }
  );
  const db = (await initializeDatabase(config, logger)) as SqliteDatabaseHandle;
  await runMigrations(db, logger);

  const account: Account = {
    id: `acc_${nanoid(21)}`,
    email: `mode-${nanoid(8)}@example.test`,
    suspendedAt: null,
  };
  if (shouldInsertAccount) {
    insertAccount(db, account);
  }

  const resolvedCloudModule = cloudModule ?? createDefaultCloudModule(config);
  const analytics = new AnalyticsRecorder({
    db,
    baseUrl: config.baseUrl as string,
    logger,
    flushIntervalMs: 60_000,
  });
  const app = createApp({ config, logger, db, cloudModule: resolvedCloudModule, analytics });
  const ctx: ViewerTestContext = {
    cwd,
    config: config as AppConfig,
    db,
    app,
    analytics,
    account,
    cloudModule: resolvedCloudModule,
    cleanup: async () => {
      await db.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
  cleanups.push(ctx.cleanup);
  return ctx;
}
