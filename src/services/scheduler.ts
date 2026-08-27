import type { AppConfig } from '../config.js';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from '../db/client.js';
import type { Account, CloudModule } from '../extension/cloud-module.js';
import type { Logger } from '../logger.js';
import { ArtifactService } from './artifacts.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = DAY_MS;
const SHARE_VIEWER_RETENTION_MS = 365 * DAY_MS;

export interface BackgroundSweepCounts {
  softDeletedArtifactsPurged: number;
  expiredSessionsDeleted: number;
  magicLinkTokensDeleted: number;
  shareViewersPruned: number;
  retentionArtifactsSoftDeleted: number;
  retentionSharesRevoked: number;
}

export interface RunBackgroundSweepsOptions {
  db: DatabaseHandle;
  config: Pick<AppConfig, 'artifactPurgeDays' | 'baseUrl'>;
  cloudModule: CloudModule;
  logger: Logger;
  now?: () => number;
}

export interface BackgroundSchedulerOptions extends RunBackgroundSweepsOptions {
  enabled?: boolean;
  intervalMs?: number;
  runImmediately?: boolean;
}

export interface BackgroundScheduler {
  runOnce(trigger?: string): Promise<BackgroundSweepCounts | null>;
  stop(): void;
}

interface RetentionCandidate {
  artifactId: string;
  account: Account;
  updatedAt: number;
}

export function startBackgroundScheduler(options: BackgroundSchedulerOptions): BackgroundScheduler {
  const enabled = options.enabled ?? true;
  const intervalMs = options.intervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const runImmediately = options.runImmediately ?? true;
  let running = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const runOnce = async (trigger = 'manual'): Promise<BackgroundSweepCounts | null> => {
    if (!enabled || stopped) {
      options.logger.debug({ trigger }, 'background.scheduler.disabled');
      return null;
    }

    if (running) {
      options.logger.warn({ trigger }, 'background.sweeps.skip_in_flight');
      return null;
    }

    running = true;
    options.logger.info({ trigger }, 'background.sweeps.start');
    try {
      const counts = await runBackgroundSweeps(options);
      options.logger.info({ trigger, ...counts }, 'background.sweeps.complete');
      return counts;
    } catch (error) {
      options.logger.error({ err: error, trigger }, 'background.sweeps.failed');
      return null;
    } finally {
      running = false;
    }
  };

  if (!enabled) {
    options.logger.info({ enabled: false }, 'background.scheduler.disabled');
    return { runOnce, stop: () => undefined };
  }

  timer = setInterval(() => {
    void runOnce('interval');
  }, intervalMs);
  timer.unref?.();

  options.logger.info(
    { interval_ms: intervalMs, run_immediately: runImmediately },
    'background.scheduler.started'
  );

  if (runImmediately) {
    void runOnce('boot');
  }

  return {
    runOnce,
    stop: () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      options.logger.info('background.scheduler.stopped');
    },
  };
}

export async function runBackgroundSweeps(
  options: RunBackgroundSweepsOptions
): Promise<BackgroundSweepCounts> {
  const now = options.now?.() ?? Date.now();
  const purgeCutoff = now - options.config.artifactPurgeDays * DAY_MS;
  const shareViewerCutoff = now - SHARE_VIEWER_RETENTION_MS;

  const softDeletedArtifactsPurged = await purgeSoftDeletedArtifacts(options.db, purgeCutoff);
  logSweepJob(options.logger, 'soft_delete_purge', softDeletedArtifactsPurged);

  const expiredSessionsDeleted = await deleteExpiredSessions(options.db, now);
  logSweepJob(options.logger, 'expired_sessions', expiredSessionsDeleted);

  const magicLinkTokensDeleted = await deleteExpiredOrConsumedMagicLinks(options.db, now);
  logSweepJob(options.logger, 'magic_link_tokens', magicLinkTokensDeleted);

  const shareViewersPruned = await pruneShareViewers(options.db, shareViewerCutoff);
  logSweepJob(options.logger, 'share_viewers_retention', shareViewersPruned);

  const retention = await softDeleteArtifactsPastPlanRetention(options, now);
  options.logger.info(
    {
      job: 'artifact_plan_retention',
      artifacts: retention.retentionArtifactsSoftDeleted,
      revoked_shares: retention.retentionSharesRevoked,
    },
    'background.sweep.job.complete'
  );

  return {
    softDeletedArtifactsPurged,
    expiredSessionsDeleted,
    magicLinkTokensDeleted,
    shareViewersPruned,
    ...retention,
  };
}

async function purgeSoftDeletedArtifacts(db: DatabaseHandle, cutoff: number): Promise<number> {
  if (db.dialect === 'sqlite') {
    const result = db.sqlite
      .prepare('DELETE FROM artifacts WHERE deleted_at IS NOT NULL AND deleted_at <= ?')
      .run(cutoff);
    return Number(result.changes);
  }

  const result = await db.pool.query(
    'DELETE FROM artifacts WHERE deleted_at IS NOT NULL AND deleted_at <= $1',
    [cutoff]
  );
  return result.rowCount ?? 0;
}

async function deleteExpiredSessions(db: DatabaseHandle, now: number): Promise<number> {
  if (db.dialect === 'sqlite') {
    const result = db.sqlite.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    return Number(result.changes);
  }

  const result = await db.pool.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  return result.rowCount ?? 0;
}

async function deleteExpiredOrConsumedMagicLinks(db: DatabaseHandle, now: number): Promise<number> {
  if (db.dialect === 'sqlite') {
    const result = db.sqlite
      .prepare('DELETE FROM magic_link_tokens WHERE expires_at <= ? OR consumed_at IS NOT NULL')
      .run(now);
    return Number(result.changes);
  }

  const result = await db.pool.query(
    'DELETE FROM magic_link_tokens WHERE expires_at <= $1 OR consumed_at IS NOT NULL',
    [now]
  );
  return result.rowCount ?? 0;
}

async function pruneShareViewers(db: DatabaseHandle, cutoff: number): Promise<number> {
  if (db.dialect === 'sqlite') {
    const result = db.sqlite
      .prepare('DELETE FROM share_viewers WHERE last_viewed_at < ?')
      .run(cutoff);
    return Number(result.changes);
  }

  const result = await db.pool.query('DELETE FROM share_viewers WHERE last_viewed_at < $1', [
    cutoff,
  ]);
  return result.rowCount ?? 0;
}

async function softDeleteArtifactsPastPlanRetention(
  options: RunBackgroundSweepsOptions,
  now: number
): Promise<
  Pick<BackgroundSweepCounts, 'retentionArtifactsSoftDeleted' | 'retentionSharesRevoked'>
> {
  const candidates = await listRetentionCandidates(options.db);
  const service = new ArtifactService({
    db: options.db,
    extension: options.cloudModule,
    baseUrl: options.config.baseUrl,
    logger: options.logger,
    now: () => now,
  });
  const accountPlanCache = new Map<string, number | null>();
  let retentionArtifactsSoftDeleted = 0;
  let retentionSharesRevoked = 0;

  for (const candidate of candidates) {
    let retentionDays = accountPlanCache.get(candidate.account.id);
    if (retentionDays === undefined) {
      const plan = await options.cloudModule.resolvePlan(candidate.account);
      retentionDays = plan.artifact_retention_days;
      accountPlanCache.set(candidate.account.id, retentionDays);
    }

    if (retentionDays === null) {
      continue;
    }

    if (candidate.updatedAt > now - retentionDays * DAY_MS) {
      continue;
    }

    const result = await service.softDeleteArtifact({
      account: candidate.account,
      artifactId: candidate.artifactId,
    });
    if (result.deleted) {
      retentionArtifactsSoftDeleted += 1;
      retentionSharesRevoked += result.revokedShareCount;
    }
  }

  return { retentionArtifactsSoftDeleted, retentionSharesRevoked };
}

async function listRetentionCandidates(db: DatabaseHandle): Promise<RetentionCandidate[]> {
  if (db.dialect === 'sqlite') {
    const handle = db as SqliteDatabaseHandle;
    const rows = handle.sqlite
      .prepare(
        `
          SELECT a.id AS artifact_id, a.account_id, a.updated_at, acc.email, acc.suspended_at
          FROM artifacts a
          INNER JOIN accounts acc ON acc.id = a.account_id
          WHERE a.deleted_at IS NULL
          ORDER BY a.account_id ASC, a.updated_at ASC, a.id ASC
        `
      )
      .all() as Array<{
      artifact_id: string;
      account_id: string;
      updated_at: number;
      email: string;
      suspended_at: number | null;
    }>;
    return rows.map((row) => ({
      artifactId: row.artifact_id,
      account: { id: row.account_id, email: row.email, suspendedAt: row.suspended_at },
      updatedAt: row.updated_at,
    }));
  }

  const handle = db as PostgresDatabaseHandle;
  const result = await handle.pool.query<{
    artifact_id: string;
    account_id: string;
    updated_at: number | string;
    email: string;
    suspended_at: number | string | null;
  }>(
    `
      SELECT a.id AS artifact_id, a.account_id, a.updated_at, acc.email, acc.suspended_at
      FROM artifacts a
      INNER JOIN accounts acc ON acc.id = a.account_id
      WHERE a.deleted_at IS NULL
      ORDER BY a.account_id ASC, a.updated_at ASC, a.id ASC
    `
  );

  return result.rows.map((row) => ({
    artifactId: row.artifact_id,
    account: {
      id: row.account_id,
      email: row.email,
      suspendedAt: row.suspended_at === null ? null : Number(row.suspended_at),
    },
    updatedAt: Number(row.updated_at),
  }));
}

function logSweepJob(logger: Logger, job: string, count: number): void {
  logger.info({ job, count }, 'background.sweep.job.complete');
}
