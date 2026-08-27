import { describe, expect, it } from 'vitest';
import {
  DashboardReadModelService,
  readDashboardListFilters,
} from '../../src/services/dashboard-read-models.js';
import {
  createIntegrationTestContext,
  type IntegrationTestContext,
  json,
  publishArtifact,
  TEST_NOW,
} from '../support/integration-harness.js';

/**
 * PRD §9.3 defines dashboard search as the §8.4.3 `q` parameter, and §4.6 forbids the two
 * search paths from behaving differently. These cases pin both halves of that: `q` is a search
 * term rather than a LIKE pattern, and the dashboard and /v1 answer every term identically.
 */
const SEED = [
  { slug: 'margin-report', title: 'Margin hit 100% this quarter' },
  { slug: 'volume-report', title: 'Volume hit 1000 units this quarter' },
  { slug: 'weekly-ops-report', title: 'Weekly Ops Report' },
  { slug: 'weekly-x-ops', title: 'WeeklyXOps rollup' },
  { slug: 'escape-notes', title: 'Path back\\slash notes' },
] as const;

const QUERIES = [
  '100%',
  '1000',
  '%',
  '_',
  '%%%%%%',
  'weekly_ops',
  'weekly ops',
  'WEEKLY OPS',
  'Report',
  'back\\slash',
  'no-such-artifact',
] as const;

describe('dashboard and /v1 search parity', () => {
  it('treats q as a literal search term, not a LIKE pattern', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      await seedArtifacts(ctx);

      // The headline case: "100%" is four characters a user typed, so it finds the artifact
      // that literally says 100% and never the one that says 1000.
      expect(await v1Search(ctx, '100%')).toEqual(['margin-report']);
      expect(await dashboardSearch(ctx, '100%')).toEqual(['margin-report']);
      expect(await v1Search(ctx, '1000')).toEqual(['volume-report']);
      expect(await dashboardSearch(ctx, '1000')).toEqual(['volume-report']);

      // A metacharacter is just a character to search for. Raw LIKE would return all five
      // seeded artifacts for both of these; escaped, `%` finds only the title that prints a
      // percent sign and `%%%%%%` finds nothing, so `q` cannot force a scan pattern.
      expect(await v1Search(ctx, '%')).toEqual(['margin-report']);
      expect(await v1Search(ctx, '%%%%%%')).toEqual([]);
      expect(await v1Search(ctx, '_')).toEqual([]);

      // `_` is a single-character wildcard in raw LIKE, so an unescaped "weekly_ops" would
      // also drag in "WeeklyXOps".
      expect(await v1Search(ctx, 'weekly_ops')).toEqual([]);
      expect(await v1Search(ctx, 'weekly-ops')).toEqual(['weekly-ops-report']);

      // The escape character itself survives a round trip.
      expect(await v1Search(ctx, 'back\\slash')).toEqual(['escape-notes']);
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns identical result sets from both search paths, metacharacters included', async () => {
    const ctx = await createIntegrationTestContext();

    try {
      await seedArtifacts(ctx);

      for (const q of QUERIES) {
        const fromApi = await v1Search(ctx, q);
        const fromDashboard = await dashboardSearch(ctx, q);
        expect(fromDashboard, `dashboard and /v1 disagree on q=${JSON.stringify(q)}`).toEqual(
          fromApi
        );
      }

      // Case folding is part of the shared predicate, not a SQLite accident.
      expect(await v1Search(ctx, 'WEEKLY OPS')).toEqual(['weekly-ops-report']);
      expect(await dashboardSearch(ctx, 'WEEKLY OPS')).toEqual(['weekly-ops-report']);
    } finally {
      await ctx.cleanup();
    }
  });
});

async function seedArtifacts(ctx: IntegrationTestContext): Promise<void> {
  for (const [index, artifact] of SEED.entries()) {
    await publishArtifact(ctx, {
      slug: artifact.slug,
      title: artifact.title,
      now: TEST_NOW - index,
    });
  }
}

async function v1Search(ctx: IntegrationTestContext, q: string): Promise<string[]> {
  const response = await ctx.app.request(`/v1/artifacts?q=${encodeURIComponent(q)}`, {
    headers: ctx.authHeaders,
  });
  expect(response.status).toBe(200);
  const body = await json(response);
  return (body.items as Array<{ slug: string }>).map((item) => item.slug);
}

async function dashboardSearch(ctx: IntegrationTestContext, q: string): Promise<string[]> {
  const readModels = new DashboardReadModelService(ctx.db, { baseUrl: ctx.config.baseUrl });
  const result = await readModels.listDashboardArtifacts({
    accountId: ctx.account.id,
    filters: readDashboardListFilters({ q }),
    retentionDays: null,
  });
  return result.artifacts.map((artifact) => artifact.slug);
}
