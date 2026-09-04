import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from '../db/client.js';
import type { Logger } from '../logger.js';
import {
  classifyDevice,
  isInternalUserAgent,
  looksLikeBrowser,
  matchBotSignature,
  type ViewDevice,
} from './bot-signatures.js';

/**
 * A repeat read inside this window is the same read. Ten seconds is inherited deliberately from the
 * mechanism this replaces (`VIEW_THROTTLE_MS`), so a refresh behaves exactly as it did before the
 * cutover — the point of this work is to change WHO gets counted, not to quietly re-scale everyone's
 * numbers at the same time.
 */
export const REPEAT_VIEW_WINDOW_MS = 10 * 1000;

/** A JS confirmation can only vouch for a read this recent. */
const CONFIRM_WINDOW_MS = 5 * 60 * 1000;

const DEFAULT_FLUSH_INTERVAL_MS = 1000;
const DEFAULT_MAX_BATCH = 500;
/** Past this the process is losing to its own traffic; drop and say so rather than grow forever. */
const DEFAULT_MAX_BUFFER = 10_000;
const RECENT_VIEWS_MAX = 10_000;
const SALT_BYTES = 32;

/** Sub-resource destinations. A page render is never one of these, so this cannot eat a reader. */
const NON_PAGE_DESTINATIONS = new Set([
  'image',
  'script',
  'style',
  'font',
  'audio',
  'video',
  'track',
  'manifest',
  'object',
  'embed',
  'report',
]);

export interface ViewRequestFacts {
  method: string;
  ip: string;
  /** Empty string when the header is absent — which is itself a signal, not a missing value. */
  userAgent: string;
  referer: string | null;
  secPurpose: string | null;
  purpose: string | null;
  xMoz: string | null;
  secFetchDest: string | null;
}

interface HeaderReader {
  method: string;
  header(name: string): string | undefined;
}

export function readViewRequestFacts(req: HeaderReader, ip: string): ViewRequestFacts {
  return {
    method: req.method,
    ip,
    userAgent: req.header('user-agent') ?? '',
    referer: req.header('referer') ?? req.header('referrer') ?? null,
    secPurpose: req.header('sec-purpose') ?? null,
    purpose: req.header('purpose') ?? null,
    xMoz: req.header('x-moz') ?? null,
    secFetchDest: req.header('sec-fetch-dest') ?? null,
  };
}

/**
 * Where the read was observed.
 *
 * `page` is the server-rendered artifact page and the only surface that counts for an ordinary
 * share. `unlock` is the one exception: a password-protected artifact renders a gate with no
 * content, so its read happens when the content is finally served — and that request is a `fetch`,
 * not a navigation, which is why the navigation check below is scoped to `page`.
 */
export type ViewSurface = 'page' | 'unlock';

export type ViewClassification = { countable: true } | { countable: false; reason: string };

export function classifyView(
  facts: ViewRequestFacts,
  context: { isOwner: boolean; surface: ViewSurface }
): ViewClassification {
  // 0 — shape of the request. HEAD serves headers and reads nothing.
  if (facts.method !== 'GET') {
    return { countable: false, reason: 'method' };
  }

  // 1 — speculative fetches. Nobody has looked at anything yet.
  const prefetch = `${facts.secPurpose ?? ''} ${facts.purpose ?? ''} ${facts.xMoz ?? ''}`;
  if (/prefetch|prerender|preview/i.test(prefetch)) {
    return { countable: false, reason: 'prefetch' };
  }

  // 2 — our own traffic, before the UA table, so it reports as ours rather than as a bot.
  if (facts.userAgent && isInternalUserAgent(facts.userAgent)) {
    return { countable: false, reason: 'internal' };
  }

  // 3 — the owner. Checking your own work is not an audience.
  if (context.isOwner) {
    return { countable: false, reason: 'owner' };
  }

  // 4 — no user agent at all. Every browser sends one; a client that does not is a script.
  if (!facts.userAgent.trim()) {
    return { countable: false, reason: 'ua_missing' };
  }

  // 5 — the declared-bot table.
  const bot = matchBotSignature(facts.userAgent);
  if (bot) {
    return { countable: false, reason: `bot:${bot}` };
  }

  // 6 — shape. Anything that reaches here without saying it is a browser is not one.
  if (!looksLikeBrowser(facts.userAgent)) {
    return { countable: false, reason: 'ua_not_browser' };
  }

  // 7 — a page read is a document request. Absent header means no verdict, never a rejection.
  if (
    context.surface === 'page' &&
    facts.secFetchDest &&
    NON_PAGE_DESTINATIONS.has(facts.secFetchDest.toLowerCase())
  ) {
    return { countable: false, reason: 'not_navigation' };
  }

  return { countable: true };
}

export interface AnalyticsCaptureInput {
  shareId: string;
  artifactId: string;
  accountId: string;
  versionNum: number;
  isOwner: boolean;
  surface: ViewSurface;
  facts: ViewRequestFacts;
}

interface PendingView {
  shareId: string;
  artifactId: string;
  accountId: string;
  versionNum: number;
  at: number;
  day: number;
  /** Raw identity, held in memory for at most one flush and never written anywhere. */
  ip: string;
  userAgent: string;
  referrerHost: string | null;
  device: ViewDevice;
}

interface PendingConfirm {
  shareId: string;
  at: number;
  day: number;
  ip: string;
  userAgent: string;
}

export interface AnalyticsRecorderOptions {
  db: DatabaseHandle;
  /** Used to drop self-referrals: arriving from our own page is not a referrer. */
  baseUrl: string;
  /**
   * The extension's `share.viewed` notification, which the old counter emitted. Kept on the same
   * signal — a counted read — so moving where counting happens does not silently change what a
   * cloud module observes.
   */
  onView?: (view: { shareId: string; artifactId: string; accountId: string; at: number }) => void;
  logger?: Logger;
  now?: () => number;
  flushIntervalMs?: number;
  maxBatch?: number;
  maxBuffer?: number;
}

/** UTC calendar day as YYYYMMDD — the grouping key, and what the salt rotates on. */
export function dayOf(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

/**
 * THE VIEW RECORDER.
 *
 * Two properties are load-bearing and everything else follows from them:
 *
 *   1. NOTHING HERE IS AWAITED BY A READER. `capture` is synchronous, does a little header work and
 *      appends to an array. The database is touched by a timer. A reader waits on analytics for
 *      exactly as long as it takes to push an object.
 *
 *   2. NO IDENTITY IS STORED. The raw IP and user agent live in the buffer for at most one flush
 *      interval and are then reduced to a salted hash whose salt is destroyed within 48 hours. The
 *      columns that reach disk cannot be reversed to a person, which is what makes the published
 *      "cookieless" claim true — it was not, while a 365-day `aa_viewer` cookie was doing this job.
 */
export class AnalyticsRecorder {
  private readonly db: DatabaseHandle;
  private readonly baseHost: string;
  private readonly onView: AnalyticsRecorderOptions['onView'];
  private readonly logger?: Logger;
  private readonly now: () => number;
  private readonly flushIntervalMs: number;
  private readonly maxBatch: number;
  private readonly maxBuffer: number;

  private views: PendingView[] = [];
  private confirms: PendingConfirm[] = [];
  private readonly recentViews = new Map<string, number>();
  private readonly salts = new Map<number, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private stopped = false;
  private dropped = 0;

  constructor(options: AnalyticsRecorderOptions) {
    this.db = options.db;
    this.baseHost = safeHost(options.baseUrl);
    this.onView = options.onView;
    if (options.logger) {
      this.logger = options.logger;
    }
    this.now = options.now ?? Date.now;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatch = options.maxBatch ?? DEFAULT_MAX_BATCH;
    this.maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
  }

  /**
   * Record a read, if it is one. Synchronous, total, and never throws: a defect in here must not
   * be able to take down the page it is measuring.
   */
  capture(input: AnalyticsCaptureInput): ViewClassification {
    try {
      const verdict = classifyView(input.facts, {
        isOwner: input.isOwner,
        surface: input.surface,
      });
      if (!verdict.countable) {
        return verdict;
      }

      const at = this.now();
      // Same reader, same artifact, moments apart: one read. Keyed on raw identity rather than the
      // hash so it needs no salt and therefore no database round trip.
      const throttleKey = `${input.shareId}\0${input.facts.ip}\0${input.facts.userAgent}`;
      const last = this.recentViews.get(throttleKey);
      if (last !== undefined && at - last < REPEAT_VIEW_WINDOW_MS) {
        return { countable: false, reason: 'repeat' };
      }
      this.recentViews.set(throttleKey, at);
      this.pruneRecentViews(at);

      if (this.views.length >= this.maxBuffer) {
        this.dropped += 1;
        return { countable: false, reason: 'buffer_full' };
      }

      this.views.push({
        shareId: input.shareId,
        artifactId: input.artifactId,
        accountId: input.accountId,
        versionNum: input.versionNum,
        at,
        day: dayOf(at),
        ip: input.facts.ip,
        userAgent: input.facts.userAgent,
        referrerHost: this.referrerHost(input.facts.referer),
        device: classifyDevice(input.facts.userAgent),
      });
      this.schedule();
      this.notify(input, at);
      return { countable: true };
    } catch (error) {
      this.logger?.warn({ err: error }, 'analytics.capture_failed');
      return { countable: false, reason: 'error' };
    }
  }

  /**
   * The reader's browser ran our script. A QUALITY SIGNAL ONLY — it never creates a view and never
   * removes one. Its job is to tell us what fraction of reads on an artifact came from something
   * that executes JavaScript, which is how we find the crawler that is not in the table yet.
   */
  confirmJs(input: { shareId: string; facts: ViewRequestFacts }): void {
    try {
      if (this.confirms.length >= this.maxBuffer) {
        return;
      }
      const at = this.now();
      this.confirms.push({
        shareId: input.shareId,
        at,
        day: dayOf(at),
        ip: input.facts.ip,
        userAgent: input.facts.userAgent,
      });
      this.schedule();
    } catch (error) {
      this.logger?.warn({ err: error }, 'analytics.confirm_failed');
    }
  }

  /** Drain everything buffered. Awaited by tests and by shutdown; never by a request. */
  async flush(): Promise<void> {
    while (this.flushing) {
      await this.flushing;
    }
    if (this.views.length === 0 && this.confirms.length === 0) {
      return;
    }
    this.flushing = this.drain();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  /** Visible in logs so silent loss is never inferred from a gap in a chart. */
  droppedCount(): number {
    return this.dropped;
  }

  private notify(input: AnalyticsCaptureInput, at: number): void {
    try {
      this.onView?.({
        shareId: input.shareId,
        artifactId: input.artifactId,
        accountId: input.accountId,
        at,
      });
    } catch (error) {
      this.logger?.warn({ err: error }, 'analytics.on_view_failed');
    }
  }

  private schedule(): void {
    if (this.stopped) {
      return;
    }
    if (this.views.length + this.confirms.length >= this.maxBatch) {
      void this.flush();
      return;
    }
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  private pruneRecentViews(now: number): void {
    if (this.recentViews.size <= RECENT_VIEWS_MAX) {
      return;
    }
    for (const [key, seen] of this.recentViews) {
      if (now - seen >= REPEAT_VIEW_WINDOW_MS) {
        this.recentViews.delete(key);
      }
    }
  }

  private referrerHost(referer: string | null): string | null {
    if (!referer) {
      return null;
    }
    const host = safeHost(referer);
    // Arriving from our own page is navigation, not a referral, and storing it would drown the
    // owner's list in their own domain.
    return !host || host === this.baseHost ? null : host;
  }

  private async drain(): Promise<void> {
    const views = this.views;
    const confirms = this.confirms;
    this.views = [];
    this.confirms = [];
    if (views.length === 0 && confirms.length === 0) {
      return;
    }

    try {
      const hashedViews = await this.hashAll(views);
      const hashedConfirms = await this.hashAll(confirms);
      if (this.db.dialect === 'sqlite') {
        this.writeSqlite(hashedViews, hashedConfirms);
      } else {
        await this.writePostgres(hashedViews, hashedConfirms);
      }
      if (this.dropped > 0) {
        this.logger?.warn({ dropped: this.dropped }, 'analytics.events_dropped');
        this.dropped = 0;
      }
    } catch (error) {
      // Analytics must never be the reason a page or a process fails. The batch is gone; say so.
      this.logger?.error(
        { err: error, views: views.length, confirms: confirms.length },
        'analytics.flush_failed'
      );
    }
  }

  private async hashAll<T extends { shareId: string; day: number; ip: string; userAgent: string }>(
    rows: T[]
  ): Promise<Array<T & { visitorHash: string }>> {
    const out: Array<T & { visitorHash: string }> = [];
    for (const row of rows) {
      const salt = await this.saltFor(row.day);
      out.push({ ...row, visitorHash: visitorHash(salt, row.shareId, row.ip, row.userAgent) });
    }
    return out;
  }

  /**
   * The day's salt, created on first use and shared by every process through the table — two
   * replicas must derive the same hash for the same reader or the visitor count doubles.
   */
  private async saltFor(day: number): Promise<string> {
    const cached = this.salts.get(day);
    if (cached) {
      return cached;
    }

    const candidate = randomBytes(SALT_BYTES).toString('hex');
    const now = this.now();
    let stored: string;

    if (this.db.dialect === 'sqlite') {
      const handle = this.db as SqliteDatabaseHandle;
      handle.sqlite
        .prepare('INSERT OR IGNORE INTO analytics_salts (day, salt, created_at) VALUES (?, ?, ?)')
        .run(day, candidate, now);
      const row = handle.sqlite
        .prepare('SELECT salt FROM analytics_salts WHERE day = ?')
        .get(day) as { salt: string } | undefined;
      stored = row?.salt ?? candidate;
    } else {
      const pool = (this.db as PostgresDatabaseHandle).pool;
      await pool.query(
        'INSERT INTO analytics_salts (day, salt, created_at) VALUES ($1, $2, $3) ON CONFLICT (day) DO NOTHING',
        [day, candidate, now]
      );
      const result = await pool.query<{ salt: string }>(
        'SELECT salt FROM analytics_salts WHERE day = $1',
        [day]
      );
      stored = result.rows[0]?.salt ?? candidate;
    }

    this.salts.set(day, stored);
    for (const known of this.salts.keys()) {
      if (known < day - 2) {
        this.salts.delete(known);
      }
    }
    return stored;
  }

  private writeSqlite(views: HashedView[], confirms: HashedConfirm[]): void {
    const handle = this.db as SqliteDatabaseHandle;
    handle.sqlite
      .transaction(() => {
        const newVisitors = new Map<string, number>();
        for (const visit of distinctVisitorDays(views)) {
          // Conflict-free by construction: the row's own key decides. Whoever inserts it counted
          // the visitor, and a racing replica gets a no-op rather than a duplicate-key error.
          const inserted = handle.sqlite
            .prepare(
              `INSERT INTO share_visitor_days (share_id, day, visitor_hash) VALUES (?, ?, ?)
               ON CONFLICT (share_id, day, visitor_hash) DO NOTHING`
            )
            .run(visit.shareId, visit.day, visit.visitorHash);
          if (inserted.changes > 0) {
            newVisitors.set(visit.shareId, (newVisitors.get(visit.shareId) ?? 0) + 1);
          }
        }

        for (const row of views) {
          handle.sqlite
            .prepare(VIEW_EVENT_INSERT_SQLITE)
            .run(
              row.shareId,
              row.artifactId,
              row.accountId,
              row.at,
              row.day,
              row.visitorHash,
              row.versionNum,
              row.referrerHost,
              row.device
            );
        }

        for (const share of aggregateShares(views, newVisitors)) {
          handle.sqlite
            .prepare(
              `UPDATE shares
               SET view_count = view_count + ?,
                   unique_viewer_count = unique_viewer_count + ?,
                   last_viewed_at = ?
               WHERE id = ?`
            )
            .run(share.views, share.newVisitors, share.lastAt, share.shareId);
        }

        for (const confirm of confirms) {
          handle.sqlite
            .prepare(
              `UPDATE view_events SET js_confirmed = 1
               WHERE share_id = ? AND visitor_hash = ? AND at >= ?`
            )
            .run(confirm.shareId, confirm.visitorHash, confirm.at - CONFIRM_WINDOW_MS);
        }
      })
      .immediate();
  }

  private async writePostgres(views: HashedView[], confirms: HashedConfirm[]): Promise<void> {
    const client = await (this.db as PostgresDatabaseHandle).pool.connect();
    try {
      await client.query('BEGIN');

      const newVisitors = new Map<string, number>();
      for (const visit of distinctVisitorDays(views)) {
        const inserted = await client.query(
          `INSERT INTO share_visitor_days (share_id, day, visitor_hash) VALUES ($1, $2, $3)
           ON CONFLICT (share_id, day, visitor_hash) DO NOTHING`,
          [visit.shareId, visit.day, visit.visitorHash]
        );
        if ((inserted.rowCount ?? 0) > 0) {
          newVisitors.set(visit.shareId, (newVisitors.get(visit.shareId) ?? 0) + 1);
        }
      }

      for (const row of views) {
        await client.query(VIEW_EVENT_INSERT_POSTGRES, [
          row.shareId,
          row.artifactId,
          row.accountId,
          row.at,
          row.day,
          row.visitorHash,
          row.versionNum,
          row.referrerHost,
          row.device,
        ]);
      }

      for (const share of aggregateShares(views, newVisitors)) {
        await client.query(
          `UPDATE shares
           SET view_count = view_count + $1,
               unique_viewer_count = unique_viewer_count + $2,
               last_viewed_at = $3
           WHERE id = $4`,
          [share.views, share.newVisitors, share.lastAt, share.shareId]
        );
      }

      for (const confirm of confirms) {
        await client.query(
          `UPDATE view_events SET js_confirmed = TRUE
           WHERE share_id = $1 AND visitor_hash = $2 AND at >= $3`,
          [confirm.shareId, confirm.visitorHash, confirm.at - CONFIRM_WINDOW_MS]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

type HashedView = PendingView & { visitorHash: string };
type HashedConfirm = PendingConfirm & { visitorHash: string };

const VIEW_EVENT_COLUMNS =
  'share_id, artifact_id, account_id, at, day, visitor_hash, version_num, referrer_host, device, js_confirmed';
const VIEW_EVENT_INSERT_SQLITE = `INSERT INTO view_events (${VIEW_EVENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`;
const VIEW_EVENT_INSERT_POSTGRES = `INSERT INTO view_events (${VIEW_EVENT_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)`;

interface VisitorDay {
  shareId: string;
  day: number;
  visitorHash: string;
}

/** One candidate row per (share, day, reader) — the batch may hold many views for each. */
function distinctVisitorDays(views: HashedView[]): VisitorDay[] {
  const seen = new Map<string, VisitorDay>();
  for (const row of views) {
    const key = `${row.shareId}\0${row.day}\0${row.visitorHash}`;
    if (!seen.has(key)) {
      seen.set(key, { shareId: row.shareId, day: row.day, visitorHash: row.visitorHash });
    }
  }
  return [...seen.values()];
}

interface ShareAggregate {
  shareId: string;
  views: number;
  newVisitors: number;
  lastAt: number;
}

/**
 * One UPDATE per share per flush rather than one per view — a hundred readers of the same artifact
 * arriving together cost a single row write.
 */
function aggregateShares(views: HashedView[], newVisitors: Map<string, number>): ShareAggregate[] {
  const byShare = new Map<string, ShareAggregate>();
  for (const row of views) {
    const current = byShare.get(row.shareId) ?? {
      shareId: row.shareId,
      views: 0,
      newVisitors: newVisitors.get(row.shareId) ?? 0,
      lastAt: 0,
    };
    current.views += 1;
    current.lastAt = Math.max(current.lastAt, row.at);
    byShare.set(row.shareId, current);
  }
  return [...byShare.values()];
}

export function visitorHash(salt: string, shareId: string, ip: string, userAgent: string): string {
  return createHash('sha256')
    .update(`${salt}\0${shareId}\0${ip}\0${userAgent}`)
    .digest('hex')
    .slice(0, 32);
}

function safeHost(value: string): string {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return '';
  }
}
