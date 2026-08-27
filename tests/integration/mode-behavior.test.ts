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
    expect(html).toContain('Your agent does the work. Artifacts is where it shows the work.');
    expect(html).toContain('stable URL, live updates, optional password');
    expect(html).toContain('Your API key: [KEY]');
    expect(html).toContain('Sign up to get your key.');
    expect(html).toContain('https://github.com/ZeroPointRepo/agent-artifacts');
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
    expect(html).toContain('Made with ◆ Agent Artifacts');
  });

  it('suppresses the public footer with AA_HIDE_FOOTER in self-hosted mode', async () => {
    const ctx = await createModeContext({
      env: { DEPLOYMENT: 'self-hosted', AA_HIDE_FOOTER: 'true' },
    });
    const published = await publishSharedArtifact(ctx);

    const response = await ctx.app.request(`/a/${published.share?.shareId}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain('Made with ◆ Agent Artifacts');
    expect(html).toContain('Report abuse');
  });

  it('uses the cloud plan hook to keep or remove the public footer in cloud mode', async () => {
    const free = await createModeContext({
      env: { DEPLOYMENT: 'cloud' },
      cloudModule: createTestCloudModule(testPlan({ id: 'free', name: 'Free', showFooter: true })),
    });
    const freeArtifact = await publishSharedArtifact(free);
    const freeHtml = await (await free.app.request(`/a/${freeArtifact.share?.shareId}`)).text();
    expect(freeHtml).toContain('Made with ◆ Agent Artifacts');

    const pro = await createModeContext({
      env: { DEPLOYMENT: 'cloud' },
      cloudModule: createTestCloudModule(testPlan({ id: 'pro', name: 'Pro', showFooter: false })),
    });
    const proArtifact = await publishSharedArtifact(pro);
    const proHtml = await (await pro.app.request(`/a/${proArtifact.share?.shareId}`)).text();
    expect(proHtml).not.toContain('Made with ◆ Agent Artifacts');
    expect(proHtml).toContain('Report abuse');
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
  const app = createApp({ config, logger, db, cloudModule: resolvedCloudModule });
  const ctx: ViewerTestContext = {
    cwd,
    config: config as AppConfig,
    db,
    app,
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
