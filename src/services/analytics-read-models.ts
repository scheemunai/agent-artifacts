import type { DatabaseHandle, PostgresDatabaseHandle } from '../db/client.js';

/**
 * WHAT THE OWNER IS SHOWN, AND WHAT IT HONESTLY MEANS.
 *
 * Identity rotates daily (see `AnalyticsRecorder`), so a reader is only recognisable within one UTC
 * day on one artifact. That makes `COUNT(DISTINCT visitor_hash)` mean different things at different
 * range lengths: over 24 hours it is distinct readers; over 30 days it is the SUM of each day's
 * distinct readers, which is a visit count, not a headcount.
 *
 * Rather than paper over that with a "unique visitors" label that would be wrong at every range
 * except the shortest, the number is called READERS everywhere and carries its definition —
 * "counted once per artifact per day" — with it. Honest and stable at every range beats a familiar
 * word that only holds for one of them.
 */

export const STATS_RANGES = ['24h', '7d', '30d'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface RangeShape {
  label: string;
  /** How far back the window reaches. */
  spanMs: number;
  /** Width of one point on the chart. */
  bucketMs: number;
}

export const RANGE_SHAPES: Record<StatsRange, RangeShape> = {
  '24h': { label: 'Last 24 hours', spanMs: DAY_MS, bucketMs: HOUR_MS },
  '7d': { label: 'Last 7 days', spanMs: 7 * DAY_MS, bucketMs: DAY_MS },
  '30d': { label: 'Last 30 days', spanMs: 30 * DAY_MS, bucketMs: DAY_MS },
};

export function parseStatsRange(value: string | undefined): StatsRange {
  return STATS_RANGES.includes(value as StatsRange) ? (value as StatsRange) : '24h';
}

export interface StatsPoint {
  /** Start of the bucket, epoch ms. */
  at: number;
  views: number;
  readers: number;
}

export interface StatsTotals {
  views: number;
  readers: number;
}

export interface RankedArtifact {
  artifactId: string;
  title: string;
  slug: string;
  views: number;
  readers: number;
}

export interface RankedLabel {
  label: string;
  views: number;
}

export interface AccountStats {
  range: StatsRange;
  /** Bucketed for the chart — always `spanMs / bucketMs` points, zeros included. */
  series: StatsPoint[];
  totals: StatsTotals;
  /** The equivalent window immediately before this one, for the change indicator. */
  previous: StatsTotals;
  mostVisited: RankedArtifact[];
  /** True when this account has never recorded a read, which reads differently from "quiet". */
  everRecorded: boolean;
}

export interface ArtifactStats {
  range: StatsRange;
  series: StatsPoint[];
  totals: StatsTotals;
  previous: StatsTotals;
  referrers: RankedLabel[];
  devices: RankedLabel[];
  lastReadAt: number | null;
  everRecorded: boolean;
}

interface Scope {
  column: 'account_id' | 'artifact_id';
  id: string;
}

export class AnalyticsReadModelService {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly now: () => number = Date.now
  ) {}

  async accountStats(accountId: string, range: StatsRange): Promise<AccountStats> {
    const scope: Scope = { column: 'account_id', id: accountId };
    const window = this.windowFor(range);
    const [series, totals, previous, mostVisited, everRecorded] = await Promise.all([
      this.series(scope, window),
      this.totals(scope, window.start, window.end),
      this.totals(scope, window.previousStart, window.start),
      this.mostVisited(accountId, window),
      this.everRecorded(scope),
    ]);
    return { range, series, totals, previous, mostVisited, everRecorded };
  }

  async artifactStats(artifactId: string, range: StatsRange): Promise<ArtifactStats> {
    const scope: Scope = { column: 'artifact_id', id: artifactId };
    const window = this.windowFor(range);
    const [series, totals, previous, referrers, devices, lastReadAt, everRecorded] =
      await Promise.all([
        this.series(scope, window),
        this.totals(scope, window.start, window.end),
        this.totals(scope, window.previousStart, window.start),
        this.topLabel(scope, window, 'referrer_host', 'Direct'),
        this.topLabel(scope, window, 'device', 'Unknown'),
        this.lastReadAt(scope),
        this.everRecorded(scope),
      ]);
    return { range, series, totals, previous, referrers, devices, lastReadAt, everRecorded };
  }

  /**
   * Buckets are aligned to their own width, not to "now" — otherwise every refresh shifts every
   * point sideways and a chart that should be still appears to shimmer.
   */
  private windowFor(range: StatsRange): {
    start: number;
    end: number;
    previousStart: number;
    bucketMs: number;
    buckets: number;
  } {
    const { spanMs, bucketMs } = RANGE_SHAPES[range];
    const end = Math.floor(this.now() / bucketMs) * bucketMs + bucketMs;
    const start = end - spanMs;
    return { start, end, previousStart: start - spanMs, bucketMs, buckets: spanMs / bucketMs };
  }

  private async series(
    scope: Scope,
    window: { start: number; end: number; bucketMs: number; buckets: number }
  ): Promise<StatsPoint[]> {
    /*
     * FLOOR, NOT BARE DIVISION, NOT `CAST`, AND GROUPED BY THE ALIAS.
     *
     * `(at - start) / bucket` looks like integer division and is not: SQLite hands the driver's
     * bound numbers back as doubles, so a bucket came out `3.3333…` and matched no index — every
     * point read zero while the headline beside it read 280. `CAST(… AS INTEGER)` would fix SQLite
     * and quietly break Postgres, which ROUNDS on cast where SQLite truncates. `floor` means the
     * same thing in both, whatever numeric type either one decides it is looking at.
     *
     * And the GROUP BY names the output column rather than repeating the expression: repeated, the
     * two copies get different placeholder numbers once rewritten for Postgres, which then does not
     * recognise them as the same thing and rejects the query for not grouping by `at`.
     */
    const rows = await this.query<{
      bucket: number | string;
      views: number | string;
      readers: number | string;
    }>(
      `SELECT FLOOR((at - ?) / ?) AS bucket,
              COUNT(*) AS views,
              COUNT(DISTINCT visitor_hash) AS readers
         FROM view_events
        WHERE ${scope.column} = ? AND at >= ? AND at < ?
        GROUP BY bucket
        ORDER BY bucket`,
      [window.start, window.bucketMs, scope.id, window.start, window.end]
    );

    const byBucket = new Map(rows.map((row) => [Math.round(Number(row.bucket)), row]));
    // Every bucket is emitted, including the empty ones. A chart drawn only from the rows that
    // exist would compress a quiet week into a straight line and read as steady traffic.
    return Array.from({ length: window.buckets }, (_, index) => {
      const row = byBucket.get(index);
      return {
        at: window.start + index * window.bucketMs,
        views: Number(row?.views ?? 0),
        readers: Number(row?.readers ?? 0),
      };
    });
  }

  private async totals(scope: Scope, start: number, end: number): Promise<StatsTotals> {
    const rows = await this.query<{ views: number | string; readers: number | string }>(
      `SELECT COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS readers
         FROM view_events
        WHERE ${scope.column} = ? AND at >= ? AND at < ?`,
      [scope.id, start, end]
    );
    return { views: Number(rows[0]?.views ?? 0), readers: Number(rows[0]?.readers ?? 0) };
  }

  private async mostVisited(
    accountId: string,
    window: { start: number; end: number }
  ): Promise<RankedArtifact[]> {
    const rows = await this.query<{
      artifact_id: string;
      title: string;
      slug: string;
      views: number | string;
      readers: number | string;
    }>(
      `SELECT e.artifact_id, a.title, a.slug,
              COUNT(*) AS views,
              COUNT(DISTINCT e.visitor_hash) AS readers
         FROM view_events e
         JOIN artifacts a ON a.id = e.artifact_id
        WHERE e.account_id = ? AND e.at >= ? AND e.at < ? AND a.deleted_at IS NULL
        GROUP BY e.artifact_id, a.title, a.slug
        ORDER BY views DESC, a.title ASC
        LIMIT 5`,
      [accountId, window.start, window.end]
    );
    return rows.map((row) => ({
      artifactId: row.artifact_id,
      title: row.title,
      slug: row.slug,
      views: Number(row.views),
      readers: Number(row.readers),
    }));
  }

  private async topLabel(
    scope: Scope,
    window: { start: number; end: number },
    column: 'referrer_host' | 'device',
    nullLabel: string
  ): Promise<RankedLabel[]> {
    const rows = await this.query<{ label: string | null; views: number | string }>(
      `SELECT ${column} AS label, COUNT(*) AS views
         FROM view_events
        WHERE ${scope.column} = ? AND at >= ? AND at < ?
        GROUP BY ${column}
        ORDER BY views DESC
        LIMIT 5`,
      [scope.id, window.start, window.end]
    );
    return rows.map((row) => ({ label: row.label ?? nullLabel, views: Number(row.views) }));
  }

  private async lastReadAt(scope: Scope): Promise<number | null> {
    const rows = await this.query<{ at: number | string | null }>(
      `SELECT MAX(at) AS at FROM view_events WHERE ${scope.column} = ?`,
      [scope.id]
    );
    const value = rows[0]?.at;
    return value === null || value === undefined ? null : Number(value);
  }

  /**
   * "Nothing yet" and "nothing lately" are different situations and deserve different words, so the
   * empty state needs to tell them apart rather than guess from a zero.
   */
  private async everRecorded(scope: Scope): Promise<boolean> {
    const rows = await this.query<{ total: number | string }>(
      `SELECT COUNT(*) AS total FROM (
         SELECT 1 FROM view_events WHERE ${scope.column} = ? LIMIT 1
       ) AS probe`,
      [scope.id]
    );
    return Number(rows[0]?.total ?? 0) > 0;
  }

  private async query<T>(sql: string, params: unknown[]): Promise<T[]> {
    if (this.db.dialect === 'sqlite') {
      return this.db.sqlite.prepare(sql).all(...(params as never[])) as T[];
    }
    let index = 0;
    const pgSql = sql.replace(/\?/g, () => `$${++index}`);
    const result = await (this.db as PostgresDatabaseHandle).pool.query(pgSql, params);
    return result.rows as T[];
  }
}

/** The change indicator's two numbers, or null when there is nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 100);
}
