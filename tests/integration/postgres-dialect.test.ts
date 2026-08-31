import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { initializeDatabase, type PostgresDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import { AuthService } from '../../src/services/auth.js';
import { DashboardReadModelService } from '../../src/services/dashboard-read-models.js';
import { runBackgroundSweeps } from '../../src/services/scheduler.js';
import { loadStarterTemplates } from '../../src/services/templates.js';
import { createShareResponse } from '../../src/services/v1.js';
import { VIEW_THROTTLE_MS, ViewerService } from '../../src/services/viewer.js';
import {
  createPostgresTestContext,
  insertPostgresShareViewer,
  POSTGRES_DAY_MS,
  POSTGRES_TEST_NOW,
  type PostgresTestContext,
  postgresArtifactService,
  postgresCountRows,
  postgresJson,
  postgresTestCloudModule,
  postgresTestConfig,
  postgresTestPlan,
  publishPostgresArtifact,
  resetPostgresDatabase,
} from '../support/postgres-harness.js';

const jsonContent = { 'Content-Type': 'application/json' };
const logger = pino({ enabled: false });
/**
 * Read from the manifest rather than written down. This was `5`, and stayed `5` when three HTML
 * starters were added — so the Postgres job went red over a number that described the seed set of
 * a month ago. The seeder and the assertion now read the same source, and adding a starter cannot
 * break this test again.
 */
const STARTER_TEMPLATE_COUNT = loadStarterTemplates().length;
const describePostgres = process.env.AA_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('PostgreSQL dialect support', () => {
  it('applies migrations to an empty PostgreSQL database and seeds required records', async () => {
    await resetPostgresDatabase();
    const config = postgresTestConfig();
    const db = (await initializeDatabase(config, logger)) as PostgresDatabaseHandle;

    try {
      await runMigrations(db, logger);

      const tables = await db.pool.query<{ table_name: string }>(
        `
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name ASC
        `
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'accounts',
        'artifact_versions',
        'artifacts',
        'bots',
        'magic_link_tokens',
        'sessions',
        'share_viewers',
        'shares',
        'stripe_events',
        'templates',
      ]);
      expect(await postgresCountRows({ db }, 'templates')).toBe(STARTER_TEMPLATE_COUNT);

      const indexes = await db.pool.query<{ indexname: string }>(
        `
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'uq_artifacts_account_slug_live',
              'uq_shares_artifact_active',
              'uq_templates_builtin_slug'
            )
          ORDER BY indexname ASC
        `
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        'uq_artifacts_account_slug_live',
        'uq_shares_artifact_active',
        'uq_templates_builtin_slug',
      ]);
    } finally {
      await db.close();
    }
  });

  it('completes first-run setup transactionally on PostgreSQL', async () => {
    await resetPostgresDatabase();
    const cwd = mkdtempSync(join(tmpdir(), 'aa-postgres-setup-'));
    const config = postgresTestConfig({ cwd, baseUrl: 'https://setup.postgres.example.test' });
    const db = (await initializeDatabase(config, logger)) as PostgresDatabaseHandle;

    try {
      await runMigrations(db, logger);
      const service = new AuthService(db, config, logger, () => POSTGRES_TEST_NOW);
      const setupToken = await service.ensureSetupToken();
      expect(setupToken).toMatch(/^[A-Za-z0-9_-]{24}$/);

      const result = await service.completeSetup({
        setupToken: setupToken as string,
        email: 'Owner@Postgres.Example.Test',
        password: 'correct horse battery staple',
        botName: 'Postgres Setup Bot',
        botByline: 'Created during dialect setup test',
      });

      expect(await service.countAccounts()).toBe(1);
      expect(result.account.email).toBe('owner@postgres.example.test');
      expect(await service.verifyBotKey(result.apiKey)).toMatchObject({
        account: { id: result.account.id, email: result.account.email },
        bot: { id: result.bot.id, name: 'Postgres Setup Bot' },
      });
      expect(await postgresCountRows({ db }, 'sessions')).toBe(1);
    } finally {
      await db.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('serves v1 API artifact, version, share, and template contracts with PostgreSQL row types', async () => {
    const ctx = await createPostgresTestContext();

    try {
      const createdResponse = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'pg-api-contract',
          title: 'Postgres API Contract',
          type: 'markdown',
          content: '# PostgreSQL\n\nAPI contract body.',
          metadata: { dialect: 'postgres' },
          share: true,
        }),
      });
      expect(createdResponse.status).toBe(201);
      const created = await postgresJson(createdResponse);
      expect(created).toMatchObject({
        slug: 'pg-api-contract',
        type: 'markdown',
        title: 'Postgres API Contract',
        content: '# PostgreSQL\n\nAPI contract body.',
        metadata: { dialect: 'postgres' },
        version_num: 1,
      });
      expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(Number.isNaN(Date.parse(String(created.created_at)))).toBe(false);
      expect(Number.isNaN(Date.parse(String(created.updated_at)))).toBe(false);
      expect(created.share).toMatchObject({ password_protected: false });

      const updatedResponse = await ctx.app.request('/v1/artifacts/pg-api-contract', {
        method: 'PUT',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          content: '# PostgreSQL\n\nUpdated body.',
          change_summary: 'pg update',
        }),
      });
      expect(updatedResponse.status).toBe(200);
      expect(await postgresJson(updatedResponse)).toMatchObject({ version_num: 2 });

      const versionsResponse = await ctx.app.request('/v1/artifacts/pg-api-contract/versions', {
        headers: ctx.authHeaders,
      });
      expect(versionsResponse.status).toBe(200);
      const versions = await postgresJson(versionsResponse);
      expect(versions).toMatchObject({ current_version_num: 2, total: 2 });
      expect(versions.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ version_num: 2, change_summary: 'pg update' }),
          expect.objectContaining({ version_num: 1 }),
        ])
      );

      const templatesResponse = await ctx.app.request('/v1/templates', {
        headers: ctx.authHeaders,
      });
      expect(templatesResponse.status).toBe(200);
      const templates = await postgresJson(templatesResponse);
      expect(Array.isArray(templates.items)).toBe(true);
      expect((templates.items as unknown[]).length).toBe(STARTER_TEMPLATE_COUNT);
    } finally {
      await ctx.cleanup();
    }
  });

  it('allocates sequential versions for concurrent slug upserts on PostgreSQL', async () => {
    const ctx = await createPostgresTestContext();

    try {
      const writes = Array.from({ length: 8 }, (_, index) =>
        postgresArtifactService(ctx, POSTGRES_TEST_NOW + index).upsertArtifact({
          account: ctx.account,
          bot: { id: ctx.bot.id, name: ctx.bot.name, byline: ctx.bot.byline },
          slug: 'pg-concurrent-slug',
          type: 'markdown',
          title: 'Postgres concurrent slug',
          content: `# version ${index + 1}\n\n${index}`,
          changeSummary: `write ${index + 1}`,
          share: true,
        })
      );

      const results = await Promise.all(writes);
      const artifactIds = new Set(results.map((result) => result.artifact.id));
      expect(artifactIds.size).toBe(1);
      expect(results.filter((result) => result.mode === 'created')).toHaveLength(1);
      expect(results.filter((result) => result.mode === 'updated')).toHaveLength(7);

      const artifactId = [...artifactIds][0] as string;
      expect(
        await postgresCountRows(ctx, 'artifacts', 'slug = $1 AND deleted_at IS NULL', [
          'pg-concurrent-slug',
        ])
      ).toBe(1);
      const versions = await ctx.db.pool.query<{ version_num: number; change_summary: string }>(
        `
          SELECT version_num, change_summary
          FROM artifact_versions
          WHERE artifact_id = $1
          ORDER BY version_num ASC
        `,
        [artifactId]
      );
      expect(versions.rows.map((row) => row.version_num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(
        await postgresCountRows(ctx, 'shares', 'artifact_id = $1 AND revoked_at IS NULL', [
          artifactId,
        ])
      ).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });

  it('enforces the one-active-share partial unique index on PostgreSQL', async () => {
    const ctx = await createPostgresTestContext();

    try {
      const artifact = await publishPostgresArtifact(ctx, {
        slug: 'pg-active-share-index',
        now: POSTGRES_TEST_NOW,
      });
      const auth = { account: ctx.account, bot: ctx.bot, apiKeyHash: 'test-hash' };

      const attempts = await Promise.all(
        Array.from({ length: 6 }, () =>
          createShareResponse({
            db: ctx.db,
            cloudModule: ctx.cloudModule,
            config: ctx.config,
            auth,
            idOrSlug: artifact.artifact.slug,
          })
        )
      );
      expect(attempts.filter((response) => response.status === 201)).toHaveLength(1);
      expect(attempts.filter((response) => response.status === 200)).toHaveLength(5);
      const shareIds = new Set(attempts.map((response) => response.body.share_id));
      expect(shareIds.size).toBe(1);
      expect(
        await postgresCountRows(ctx, 'shares', 'artifact_id = $1 AND revoked_at IS NULL', [
          artifact.artifact.id,
        ])
      ).toBe(1);

      await expect(
        ctx.db.pool.query(
          `
            INSERT INTO shares (
              id, artifact_id, password_hash, password_updated_at, expires_at, revoked_at,
              view_count, unique_viewer_count, last_viewed_at, created_at
            )
            VALUES ('duplicate-active-share', $1, NULL, NULL, NULL, NULL, 0, 0, NULL, $2)
          `,
          [artifact.artifact.id, POSTGRES_TEST_NOW]
        )
      ).rejects.toMatchObject({ code: '23505' });

      await ctx.db.pool.query('UPDATE shares SET revoked_at = $1 WHERE artifact_id = $2', [
        POSTGRES_TEST_NOW + 1,
        artifact.artifact.id,
      ]);
      await ctx.db.pool.query(
        `
          INSERT INTO shares (
            id, artifact_id, password_hash, password_updated_at, expires_at, revoked_at,
            view_count, unique_viewer_count, last_viewed_at, created_at
          )
          VALUES ('replacement-active-share', $1, NULL, NULL, NULL, NULL, 0, 0, NULL, $2)
        `,
        [artifact.artifact.id, POSTGRES_TEST_NOW + 2]
      );
      expect(
        await postgresCountRows(ctx, 'shares', 'artifact_id = $1 AND revoked_at IS NULL', [
          artifact.artifact.id,
        ])
      ).toBe(1);
      expect(
        await postgresCountRows(ctx, 'shares', 'artifact_id = $1', [artifact.artifact.id])
      ).toBe(2);
    } finally {
      await ctx.cleanup();
    }
  });

  it('records racing first views on PostgreSQL without a duplicate-key failure', async () => {
    const ctx = await createPostgresTestContext();

    try {
      const created = await publishPostgresArtifact(ctx, {
        slug: 'pg-concurrent-first-view',
        now: POSTGRES_TEST_NOW,
        share: true,
      });
      const shareId = created.share?.shareId as string;
      const viewerId = '00000000-0000-4000-8000-000000000512';
      const recordView = (): Promise<boolean> =>
        // A fresh service per racer, so the in-process throttle cannot mask the database
        // race that PRD §7.2.8's upsert exists to survive.
        new ViewerService({
          db: ctx.db,
          config: ctx.config,
          cloudModule: ctx.cloudModule,
          logger,
          now: () => POSTGRES_TEST_NOW,
        }).recordView({
          shareId,
          artifactId: created.artifact.id,
          accountId: ctx.account.id,
          viewerId,
        });

      const counted = await Promise.all(Array.from({ length: 8 }, recordView));

      expect(counted.filter(Boolean)).toHaveLength(1);
      expect(await postgresCountRows(ctx, 'share_viewers', 'share_id = $1', [shareId])).toBe(1);
      expect(await postgresShareCounters(ctx, shareId)).toEqual({
        view_count: 1,
        unique_viewer_count: 1,
      });

      const ledger = await ctx.db.pool.query<{ view_count: number; last_viewed_at: number }>(
        'SELECT view_count, last_viewed_at FROM share_viewers WHERE share_id = $1 AND viewer_id = $2',
        [shareId, viewerId]
      );
      expect(ledger.rows[0]).toEqual({ view_count: 1, last_viewed_at: POSTGRES_TEST_NOW });

      // The same viewer past the throttle window counts again without a second ledger row.
      const laterViewer = new ViewerService({
        db: ctx.db,
        config: ctx.config,
        cloudModule: ctx.cloudModule,
        logger,
        now: () => POSTGRES_TEST_NOW + VIEW_THROTTLE_MS,
      });
      expect(
        await laterViewer.recordView({
          shareId,
          artifactId: created.artifact.id,
          accountId: ctx.account.id,
          viewerId,
        })
      ).toBe(true);
      expect(await postgresCountRows(ctx, 'share_viewers', 'share_id = $1', [shareId])).toBe(1);
      expect(await postgresShareCounters(ctx, shareId)).toEqual({
        view_count: 2,
        unique_viewer_count: 1,
      });

      // The public reader stays a 200 under the same concurrency.
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          ctx.app.request(`/a/${shareId}/content`, {
            headers: { Cookie: 'aa_viewer=00000000-0000-4000-8000-000000000513' },
          })
        )
      );
      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(await postgresCountRows(ctx, 'share_viewers', 'share_id = $1', [shareId])).toBe(2);
      expect(await postgresShareCounters(ctx, shareId)).toEqual({
        view_count: 3,
        unique_viewer_count: 2,
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('searches dashboard artifacts case-insensitively on PostgreSQL', async () => {
    const ctx = await createPostgresTestContext();

    try {
      await publishPostgresArtifact(ctx, {
        slug: 'weekly-ops-report',
        title: 'Weekly Ops Report',
        now: POSTGRES_TEST_NOW,
      });
      await publishPostgresArtifact(ctx, {
        slug: 'launch-checklist',
        title: 'launch checklist',
        now: POSTGRES_TEST_NOW - 1,
      });
      await publishPostgresArtifact(ctx, {
        slug: 'margin-report',
        title: 'Margin hit 100% this quarter',
        now: POSTGRES_TEST_NOW - 2,
      });
      await publishPostgresArtifact(ctx, {
        slug: 'volume-report',
        title: 'Volume hit 1000 units this quarter',
        now: POSTGRES_TEST_NOW - 3,
      });

      const readModels = new DashboardReadModelService(ctx.db, { baseUrl: ctx.config.baseUrl });
      const dashboardSearch = async (q: string): Promise<string[]> => {
        const result = await readModels.listDashboardArtifacts({
          accountId: ctx.account.id,
          filters: { q, botId: '', type: '', cursor: '' },
          retentionDays: null,
        });
        return result.artifacts.map((artifact) => artifact.slug);
      };
      const apiSearch = async (q: string): Promise<string[]> => {
        const response = await ctx.app.request(`/v1/artifacts?q=${encodeURIComponent(q)}`, {
          headers: ctx.authHeaders,
        });
        expect(response.status).toBe(200);
        const body = await postgresJson(response);
        return (body.items as Array<{ slug: string }>).map((item) => item.slug);
      };

      // PRD §4.6: lower(column) LIKE lower(?) — bare LIKE is case-sensitive on PostgreSQL, so
      // each of these misses unless both sides are lowered, exactly as §8.4.3 `q` already does.
      expect(await dashboardSearch('report')).toEqual([
        'weekly-ops-report',
        'margin-report',
        'volume-report',
      ]);
      expect(await dashboardSearch('WEEKLY OPS')).toEqual(['weekly-ops-report']);
      expect(await dashboardSearch('LAUNCH-CHECKLIST')).toEqual(['launch-checklist']);
      expect(await dashboardSearch('Checklist')).toEqual(['launch-checklist']);
      expect(await dashboardSearch('nothing-matches-this')).toEqual([]);

      // PostgreSQL defaults LIKE's escape character to a backslash while SQLite has none, so
      // the shared predicate names it. Both dialects must land on the same rows for the same q.
      for (const q of ['100%', '1000', '%', '%%%%%%', 'weekly_ops', 'WEEKLY OPS', 'Report']) {
        expect(
          await dashboardSearch(q),
          `dashboard and /v1 disagree on q=${JSON.stringify(q)}`
        ).toEqual(await apiSearch(q));
      }
      expect(await dashboardSearch('100%')).toEqual(['margin-report']);
      expect(await dashboardSearch('1000')).toEqual(['volume-report']);
      expect(await dashboardSearch('%%%%%%')).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps purge/read/share races coherent on PostgreSQL', async () => {
    const ctx = await createPostgresTestContext({ artifactPurgeDays: 30 });

    try {
      const created = await publishPostgresArtifact(ctx, {
        slug: 'pg-purge-race',
        now: POSTGRES_TEST_NOW - 45 * POSTGRES_DAY_MS,
        content: '# purge race v1',
        share: true,
      });
      await publishPostgresArtifact(ctx, {
        slug: created.artifact.slug,
        now: POSTGRES_TEST_NOW - 44 * POSTGRES_DAY_MS,
        title: created.artifact.title,
        content: '# purge race v2',
        share: true,
      });
      const shareId = created.share?.shareId as string;
      await insertPostgresShareViewer(
        ctx,
        shareId,
        '00000000-0000-4000-8000-000000000024',
        POSTGRES_TEST_NOW - 43 * POSTGRES_DAY_MS,
        POSTGRES_TEST_NOW - 43 * POSTGRES_DAY_MS
      );

      const softDeleted = await postgresArtifactService(
        ctx,
        POSTGRES_TEST_NOW - 31 * POSTGRES_DAY_MS
      ).softDeleteArtifact({ account: ctx.account, artifactId: created.artifact.id });
      expect(softDeleted).toEqual({ deleted: true, revokedShareCount: 1 });

      const readDuringPurge = ctx.app.request(`/a/${shareId}/content`, {
        headers: { Cookie: 'aa_viewer=00000000-0000-4000-8000-000000000024' },
      });
      const shareDuringPurge = ctx.app.request(`/v1/artifacts/${created.artifact.slug}/share`, {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: '{}',
      });
      const purgeDuringRequests = runBackgroundSweeps({
        db: ctx.db,
        config: ctx.config,
        cloudModule: ctx.cloudModule,
        logger,
        now: () => POSTGRES_TEST_NOW,
      });

      const [readResponse, shareResponse, purgeCounts] = await Promise.all([
        readDuringPurge,
        shareDuringPurge,
        purgeDuringRequests,
      ]);

      expect([404, 410]).toContain(readResponse.status);
      if (readResponse.status === 410) {
        expect(await postgresJson(readResponse)).toMatchObject({
          error: { code: 'share_revoked' },
        });
      } else {
        expect(await postgresJson(readResponse)).toMatchObject({ error: { code: 'not_found' } });
      }
      expect(shareResponse.status).toBe(404);
      expect(await postgresJson(shareResponse)).toMatchObject({ error: { code: 'not_found' } });
      expect(purgeCounts.softDeletedArtifactsPurged).toBe(1);
      expect(await postgresCountRows(ctx, 'artifacts', 'id = $1', [created.artifact.id])).toBe(0);
      expect(
        await postgresCountRows(ctx, 'artifact_versions', 'artifact_id = $1', [created.artifact.id])
      ).toBe(0);
      expect(await postgresCountRows(ctx, 'shares', 'id = $1', [shareId])).toBe(0);
      expect(await postgresCountRows(ctx, 'share_viewers', 'share_id = $1', [shareId])).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });

  it('runs retention and viewer-ledger sweeps against PostgreSQL without losing aggregates', async () => {
    const ctx = await createPostgresTestContext({
      artifactPurgeDays: 30,
      cloudModule: postgresTestCloudModule(
        postgresTestPlan({ artifact_retention_days: 7, showFooter: true })
      ),
    });

    try {
      const expired = await publishPostgresArtifact(ctx, {
        slug: 'pg-retention-expired',
        now: POSTGRES_TEST_NOW - 8 * POSTGRES_DAY_MS,
        share: true,
      });
      const fresh = await publishPostgresArtifact(ctx, {
        slug: 'pg-retention-fresh',
        now: POSTGRES_TEST_NOW - 6 * POSTGRES_DAY_MS,
        share: true,
      });
      const shareId = expired.share?.shareId as string;
      const oldViewer = '00000000-0000-4000-8000-000000000365';
      const boundaryViewer = '00000000-0000-4000-8000-000000000366';
      await insertPostgresShareViewer(
        ctx,
        shareId,
        oldViewer,
        POSTGRES_TEST_NOW - 366 * POSTGRES_DAY_MS,
        POSTGRES_TEST_NOW - 366 * POSTGRES_DAY_MS,
        2
      );
      await insertPostgresShareViewer(
        ctx,
        shareId,
        boundaryViewer,
        POSTGRES_TEST_NOW - 365 * POSTGRES_DAY_MS,
        POSTGRES_TEST_NOW - 365 * POSTGRES_DAY_MS,
        1
      );
      await ctx.db.pool.query(
        `
          UPDATE shares
          SET view_count = 3, unique_viewer_count = 2, last_viewed_at = $1
          WHERE id = $2
        `,
        [POSTGRES_TEST_NOW - 365 * POSTGRES_DAY_MS, shareId]
      );

      const counts = await runBackgroundSweeps({
        db: ctx.db,
        config: ctx.config,
        cloudModule: ctx.cloudModule,
        logger,
        now: () => POSTGRES_TEST_NOW,
      });

      expect(counts.retentionArtifactsSoftDeleted).toBe(1);
      expect(counts.retentionSharesRevoked).toBe(1);
      expect(counts.shareViewersPruned).toBe(1);
      const expiredArtifact = await ctx.db.pool.query<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM artifacts WHERE id = $1',
        [expired.artifact.id]
      );
      expect(expiredArtifact.rows[0]?.deleted_at).toBe(POSTGRES_TEST_NOW);
      const freshArtifact = await ctx.db.pool.query<{ deleted_at: number | null }>(
        'SELECT deleted_at FROM artifacts WHERE id = $1',
        [fresh.artifact.id]
      );
      expect(freshArtifact.rows[0]?.deleted_at).toBeNull();
      const share = await ctx.db.pool.query<{
        revoked_at: number | null;
        view_count: number;
        unique_viewer_count: number;
      }>('SELECT revoked_at, view_count, unique_viewer_count FROM shares WHERE id = $1', [shareId]);
      expect(share.rows[0]).toMatchObject({
        revoked_at: POSTGRES_TEST_NOW,
        view_count: 3,
        unique_viewer_count: 2,
      });
      expect(
        await postgresCountRows(ctx, 'share_viewers', 'share_id = $1 AND viewer_id = $2', [
          shareId,
          oldViewer,
        ])
      ).toBe(0);
      expect(
        await postgresCountRows(ctx, 'share_viewers', 'share_id = $1 AND viewer_id = $2', [
          shareId,
          boundaryViewer,
        ])
      ).toBe(1);
    } finally {
      await ctx.cleanup();
    }
  });
});

async function postgresShareCounters(
  ctx: Pick<PostgresTestContext, 'db'>,
  shareId: string
): Promise<{ view_count: number; unique_viewer_count: number }> {
  const result = await ctx.db.pool.query<{ view_count: number; unique_viewer_count: number }>(
    'SELECT view_count, unique_viewer_count FROM shares WHERE id = $1',
    [shareId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`Missing share ${shareId}`);
  }
  return { view_count: row.view_count, unique_viewer_count: row.unique_viewer_count };
}
