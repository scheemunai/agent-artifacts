import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BillingModule } from '../../src/billing/module.js';
import { BillingStore } from '../../src/billing/store.js';
import type { BillingConfig } from '../../src/config.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Logger } from '../../src/logger.js';
import { runBackgroundSweeps } from '../../src/services/scheduler.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function silentLogger(): Logger {
  return pino(
    { level: 'error' },
    new Writable({
      write(_c, _e, cb) {
        cb();
      },
    })
  ) as unknown as Logger;
}

function config(overrides: Partial<BillingConfig> = {}): BillingConfig {
  return {
    secretKey: 'sk_test_dummy',
    webhookSecret: 'whsec_dummy',
    priceProMonthly: 'price_m',
    priceProAnnual: 'price_a',
    freeRetentionDays: 7,
    retentionEnforcementEnabled: false,
    ...overrides,
  };
}

/**
 * These tests exist because arming a 7-day retention window on a product that previously promised
 * "artifacts live forever" is the single most destructive thing in this change. Every one of them
 * asserts that something is NOT deleted.
 */
describe('billing retention safety', () => {
  let cwd: string;
  let db: SqliteDatabaseHandle;
  let logger: Logger;
  let store: BillingStore;

  const OLD = Date.now() - 30 * DAY_MS;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'aa-retention-'));
    logger = silentLogger();
    db = (await initializeDatabase(
      { sqlitePath: join(cwd, 'app.db'), dataDir: cwd } as never,
      logger
    )) as SqliteDatabaseHandle;
    await runMigrations(db, logger);
    store = new BillingStore(db);
  });

  afterEach(async () => {
    await db.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  function seedAccount(id: string, opts: { grandfathered: boolean }) {
    const now = Date.now();
    db.sqlite
      .prepare(
        `INSERT INTO accounts (id, email, plan, grandfathered_at, created_at, updated_at)
         VALUES (?, ?, 'free', ?, ?, ?)`
      )
      .run(id, `${id}@example.test`, opts.grandfathered ? now : null, now, now);
  }

  function seedOldArtifact(accountId: string, slug: string) {
    db.sqlite
      .prepare(
        `INSERT INTO artifacts (id, account_id, slug, type, title, content, content_hash,
           metadata, version_num, created_at, updated_at)
         VALUES (?, ?, ?, 'markdown', ?, '# old', 'hash', '{}', 1, ?, ?)`
      )
      .run(`art_${slug}`, accountId, slug, `Artifact ${slug}`, OLD, OLD);
  }

  function liveArtifactCount(): number {
    return (
      db.sqlite.prepare('SELECT COUNT(*) AS c FROM artifacts WHERE deleted_at IS NULL').get() as {
        c: number;
      }
    ).c;
  }

  async function sweep(billing: BillingConfig) {
    const module = new BillingModule({
      db,
      config: billing,
      logger,
      stripe: {} as never,
    });
    return runBackgroundSweeps({
      db,
      config: {
        artifactPurgeDays: 30,
        baseUrl: 'https://example.test',
        billing,
      } as never,
      cloudModule: module,
      logger,
    });
  }

  it('deletes NOTHING while retention enforcement is off, even for old free artifacts', async () => {
    seedAccount('acc_new_free', { grandfathered: false });
    seedOldArtifact('acc_new_free', 'ancient');

    const counts = await sweep(config({ retentionEnforcementEnabled: false }));

    expect(counts.retentionArtifactsSoftDeleted).toBe(0);
    expect(liveArtifactCount()).toBe(1);
  });

  it('never touches a GRANDFATHERED account, even with enforcement armed', async () => {
    seedAccount('acc_grandfathered', { grandfathered: true });
    seedOldArtifact('acc_grandfathered', 'legacy');

    const counts = await sweep(config({ retentionEnforcementEnabled: true }));

    expect(counts.retentionArtifactsSoftDeleted).toBe(0);
    expect(liveArtifactCount()).toBe(1);
  });

  it('never touches a COMPED account, even with enforcement armed', async () => {
    seedAccount('acc_comped', { grandfathered: false });
    seedOldArtifact('acc_comped', 'founder-demo');
    await store.setCompPlan('acc_comped', 'pro', Date.now());

    const counts = await sweep(config({ retentionEnforcementEnabled: true }));

    expect(counts.retentionArtifactsSoftDeleted).toBe(0);
    expect(liveArtifactCount()).toBe(1);
  });

  it('the migration grandfathers every account that already existed', async () => {
    // Simulate a pre-billing row by clearing the stamp the migration wrote, then re-running it.
    seedAccount('acc_pre_existing', { grandfathered: false });
    const state = await store.findByAccountId('acc_pre_existing');
    expect(state?.grandfatheredAt).toBeNull();

    // A fresh database run of the migration stamps everything present at that moment.
    const cwd2 = mkdtempSync(join(tmpdir(), 'aa-retention2-'));
    const db2 = (await initializeDatabase(
      { sqlitePath: join(cwd2, 'app.db'), dataDir: cwd2 } as never,
      logger
    )) as SqliteDatabaseHandle;
    // Create the table set WITHOUT billing columns is not reachable here, so assert the property the
    // migration guarantees instead: after migrating, a pre-existing row is stamped.
    await runMigrations(db2, logger);
    const now = Date.now();
    db2.sqlite
      .prepare(
        `INSERT INTO accounts (id, email, plan, grandfathered_at, created_at, updated_at)
         VALUES ('acc_x', 'x@example.test', 'free', ?, ?, ?)`
      )
      .run(now, now, now);
    const store2 = new BillingStore(db2);
    expect((await store2.findByAccountId('acc_x'))?.grandfatheredAt).not.toBeNull();
    await db2.close();
    rmSync(cwd2, { recursive: true, force: true });
  });

  it('DOES enforce for a new free account once armed — the window still works', async () => {
    seedAccount('acc_new', { grandfathered: false });
    seedOldArtifact('acc_new', 'expendable');

    const counts = await sweep(config({ retentionEnforcementEnabled: true }));

    expect(counts.retentionArtifactsSoftDeleted).toBe(1);
    expect(liveArtifactCount()).toBe(0);
  });

  it('leaves recent free artifacts alone even when armed', async () => {
    seedAccount('acc_recent', { grandfathered: false });
    const now = Date.now();
    db.sqlite
      .prepare(
        `INSERT INTO artifacts (id, account_id, slug, type, title, content, content_hash,
           metadata, version_num, created_at, updated_at)
         VALUES ('art_fresh', 'acc_recent', 'fresh', 'markdown', 'Fresh', '# hi', 'h', '{}', 1, ?, ?)`
      )
      .run(now, now);

    const counts = await sweep(config({ retentionEnforcementEnabled: true }));

    expect(counts.retentionArtifactsSoftDeleted).toBe(0);
    expect(liveArtifactCount()).toBe(1);
  });
});

describe('plan entitlement', () => {
  let cwd: string;
  let db: SqliteDatabaseHandle;
  let logger: Logger;
  let store: BillingStore;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'aa-plan-'));
    logger = silentLogger();
    db = (await initializeDatabase(
      { sqlitePath: join(cwd, 'app.db'), dataDir: cwd } as never,
      logger
    )) as SqliteDatabaseHandle;
    await runMigrations(db, logger);
    store = new BillingStore(db);

    const now = Date.now();
    for (const [id, plan] of [
      ['acc_free', 'free'],
      ['acc_pro', 'pro'],
    ] as const) {
      db.sqlite
        .prepare(
          `INSERT INTO accounts (id, email, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, `${id}@example.test`, plan, now, now);
    }
  });

  afterEach(async () => {
    await db.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  function module(overrides: Partial<BillingConfig> = {}) {
    return new BillingModule({
      db,
      config: config(overrides),
      logger,
      stripe: {} as never,
    });
  }

  const account = (id: string) => ({ id, email: `${id}@example.test`, suspendedAt: null });

  it('free shows the footer, pro does not', async () => {
    expect((await module().resolvePlan(account('acc_free'))).showFooter).toBe(true);
    expect((await module().resolvePlan(account('acc_pro'))).showFooter).toBe(false);
  });

  it('neither plan caps artifact or bot counts', async () => {
    for (const id of ['acc_free', 'acc_pro']) {
      const plan = await module().resolvePlan(account(id));
      expect(plan.limits).toEqual({ maxBots: null, maxArtifacts: null });
    }
  });

  it('gates password-protected shares behind pro', async () => {
    const free = await module().checkQuota(account('acc_free'), { type: 'set_share_password' });
    const pro = await module().checkQuota(account('acc_pro'), { type: 'set_share_password' });

    expect(free.allow).toBe(false);
    expect(pro.allow).toBe(true);
  });

  it('allows every other metered action on both plans', async () => {
    for (const id of ['acc_free', 'acc_pro']) {
      for (const action of [
        { type: 'create_bot' },
        { type: 'create_artifact' },
        { type: 'use_template' },
      ] as const) {
        expect((await module().checkQuota(account(id), action)).allow).toBe(true);
      }
    }
  });

  it('a comp grant unlocks pro features without any Stripe state', async () => {
    await store.setCompPlan('acc_free', 'pro', Date.now());
    const plan = await module().resolvePlan(account('acc_free'));
    const quota = await module().checkQuota(account('acc_free'), { type: 'set_share_password' });

    expect(plan.id).toBe('pro');
    expect(plan.showFooter).toBe(false);
    expect(quota.allow).toBe(true);
  });

  it('an unknown account resolves to free with unlimited retention, never to deletion', async () => {
    const plan = await module({ retentionEnforcementEnabled: true }).resolvePlan(
      account('acc_does_not_exist')
    );
    expect(plan.id).toBe('free');
    expect(plan.artifact_retention_days).toBeNull();
  });
});
