import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import type { CloudModule, Plan } from '../../src/extension/cloud-module.js';
import {
  type AuthTestContext,
  cookieFrom,
  createAuthTestContext,
  formBody,
} from './auth-test-utils.js';

const plan: Plan = {
  id: 'test',
  name: 'Test',
  showFooter: true,
  limits: { maxBots: null, maxArtifacts: null },
  artifact_retention_days: null,
};

describe('CloudModule extension hooks', () => {
  it('calls registerRoutes during app boot so a cloud route responds', async () => {
    const ctx = await createContextWithHookModule();

    try {
      const response = await ctx.app.request('/cloud/ping');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, source: 'cloud-module' });
    } finally {
      await ctx.cleanup();
    }
  });

  it('renders CloudModule navItems in the dashboard nav', async () => {
    const ctx = await createContextWithHookModule();

    try {
      const cookie = await completeSetup(ctx);
      const response = await ctx.app.request('/dashboard', {
        headers: { Cookie: cookie },
      });
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('Cloud Billing');
      expect(html).toContain('href="/cloud/billing"');
    } finally {
      await ctx.cleanup();
    }
  });
});

async function createContextWithHookModule(): Promise<AuthTestContext> {
  const cloudModule: CloudModule = {
    resolvePlan: async () => plan,
    checkQuota: async () => ({ allow: true }),
    registerRoutes(app: OpenAPIHono) {
      app.get('/cloud/ping', (context) => context.json({ ok: true, source: 'cloud-module' }));
    },
    navItems() {
      return [{ label: 'Cloud Billing', href: '/cloud/billing' }];
    },
  };

  return createAuthTestContext({}, { cloudModule });
}

async function completeSetup(ctx: AuthTestContext): Promise<string> {
  await ctx.app.request('/setup');
  const setupToken = readFileSync(join(ctx.config.dataDir, '.setup-token'), 'utf8').trim();
  const response = await ctx.app.request('/setup', {
    method: 'POST',
    ...formBody({
      setup_token: setupToken,
      email: 'admin@example.test',
      password: 'correct horse battery staple',
      password_confirm: 'correct horse battery staple',
      bot_name: 'R2',
      bot_byline: 'Hook test bot',
    }),
  });
  expect(response.status).toBe(200);
  return cookieFrom(response);
}
