import type { QueryResult, QueryResultRow } from 'pg';
import type { DatabaseHandle, PostgresDatabaseHandle } from '../db/client.js';
import { renderMarkdown } from '../lib/markdown.js';
import { caseInsensitiveContainsClause, likeContainsParam } from '../lib/search-query.js';

export type DashboardArtifactType = 'markdown' | 'html';

export interface DashboardListFilters {
  q: string;
  botId: string;
  type: string;
  cursor: string;
}

export interface DashboardShareViewModel {
  id: string;
  url: string;
  passwordProtected: boolean;
  viewCount: number;
  uniqueViewerCount: number;
  lastViewedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

export interface DashboardArtifactListViewModel {
  id: string;
  title: string;
  slug: string;
  type: DashboardArtifactType;
  updatedAt: number;
  botName: string | null;
  botByline: string | null;
  activeShare: DashboardShareViewModel | null;
  lifetimeViews: number;
  previousShareCount: number;
  expiresAt: number | null;
}

export interface DashboardArtifactDetailViewModel extends DashboardArtifactListViewModel {
  content: string;
  contentHash: string;
  versionNum: number;
  htmlPreview: string | null;
}

export interface DashboardArtifactVersionViewModel {
  versionNum: number;
  type: DashboardArtifactType;
  title: string;
  content: string;
  contentHash: string;
  changeSummary: string | null;
  restoredFromVersion: number | null;
  createdByBotName: string | null;
  createdAt: number;
}

export interface DashboardTemplateViewModel {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  thumbnailUrl: string | null;
  type: DashboardArtifactType;
  slots: string[];
  builtIn: boolean;
}

interface ArtifactQueryRow extends QueryResultRow {
  id: string;
  account_id: string;
  slug: string;
  type: DashboardArtifactType;
  title: string;
  content: string;
  content_hash: string;
  version_num: number;
  updated_at: number;
  created_at: number;
  created_by_bot: string | null;
  bot_name: string | null;
  bot_byline: string | null;
  share_id: string | null;
  share_password_hash: string | null;
  share_expires_at: number | null;
  share_revoked_at: number | null;
  share_view_count: number | null;
  share_unique_viewer_count: number | null;
  share_last_viewed_at: number | null;
  share_created_at: number | null;
}

interface ShareAggregateRow extends QueryResultRow {
  lifetime_views: number | string | null;
  previous_share_count: number | string | null;
}

interface VersionQueryRow extends QueryResultRow {
  artifact_id: string;
  version_num: number;
  type: DashboardArtifactType;
  title: string;
  content: string;
  content_hash: string;
  change_summary: string | null;
  restored_from_version: number | null;
  created_by_bot: string | null;
  created_at: number;
  bot_name: string | null;
}

interface TemplateQueryRow extends QueryResultRow {
  id: string;
  account_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  type: DashboardArtifactType;
  content: string;
  slots: string;
  created_from_artifact: string | null;
  created_at: number;
  updated_at: number;
}

const pageSize = 20;
const dayMs = 86_400_000;

export function readDashboardListFilters(
  query: Record<string, string | string[]>
): DashboardListFilters {
  return {
    q: scalarQuery(query.q),
    botId: scalarQuery(query.bot),
    type: scalarQuery(query.type),
    cursor: scalarQuery(query.cursor),
  };
}

export class DashboardReadModelService {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly options: { baseUrl: string }
  ) {}

  async listDashboardArtifacts(input: {
    accountId: string;
    filters: DashboardListFilters;
    retentionDays: number | null;
  }): Promise<{
    artifacts: DashboardArtifactListViewModel[];
    nextCursor: string | null;
    cursorRejected: boolean;
  }> {
    const cursor = decodeCursor(input.filters.cursor);
    // "Rejected", not "expired": a cursor that fails to decode may be stale, truncated by a mail
    // client, or edited by hand, and this layer cannot tell those apart. It reports the fact it
    // has — the reader was sent somewhere the list could not honour — and lets the route choose
    // the kindest true wording. An absent cursor is not a rejected one.
    const cursorRejected = Boolean(input.filters.cursor) && cursor === null;
    const params: unknown[] = [input.accountId];
    const clauses = ['a.account_id = ?', 'a.deleted_at IS NULL'];

    if (input.filters.q) {
      // PRD §9.3: dashboard search is the §8.4.3 `q` parameter, so it shares one predicate
      // with /v1 rather than keeping a lookalike of its own.
      clauses.push(caseInsensitiveContainsClause(['a.title', 'a.slug']));
      const like = likeContainsParam(input.filters.q);
      params.push(like, like);
    }
    if (input.filters.botId) {
      clauses.push('a.created_by_bot = ?');
      params.push(input.filters.botId);
    }
    if (input.filters.type === 'markdown' || input.filters.type === 'html') {
      clauses.push('a.type = ?');
      params.push(input.filters.type);
    }
    if (cursor) {
      clauses.push('(a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))');
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    params.push(pageSize + 1);

    const sql = artifactSelectSql(
      clauses.join(' AND '),
      'ORDER BY a.updated_at DESC, a.id DESC LIMIT ?'
    );
    const rows = await queryArtifacts(this.db, sql, params);
    const pageRows = rows.slice(0, pageSize);
    const artifacts = await Promise.all(
      pageRows.map((row) => this.artifactListItemFromRow(row, input.retentionDays))
    );
    const nextCursor = rows.length > pageSize ? encodeCursor(pageRows[pageRows.length - 1]) : null;
    return { artifacts, nextCursor, cursorRejected };
  }

  async getDashboardArtifactDetail(input: {
    accountId: string;
    artifactId: string;
    retentionDays: number | null;
  }): Promise<DashboardArtifactDetailViewModel | null> {
    const sql = artifactSelectSql(
      'a.account_id = ? AND a.id = ? AND a.deleted_at IS NULL',
      'LIMIT 1'
    );
    const rows = await queryArtifacts(this.db, sql, [input.accountId, input.artifactId]);
    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      ...(await this.artifactListItemFromRow(row, input.retentionDays)),
      content: row.content,
      contentHash: row.content_hash,
      versionNum: row.version_num,
      htmlPreview:
        row.type === 'markdown'
          ? // Offset 1 is deliberate and load-bearing: the preview embeds a whole document inside
            // a page that already has its own h1, so the embedded headings are demoted to keep
            // exactly one h1 per page. Setting this to 0 to match the viewer byte-for-byte —
            // which is what "preview parity" sounds like it wants — puts two h1s on the artifact
            // detail page; dashboard-heading-regression.test.ts measures it as 2 and fails. The
            // hierarchy the owner sees is the same one the reader gets, shifted by one level, and
            // the offset is part of the render-cache key precisely so the two may differ safely.
            renderMarkdown(row.content, { contentHash: row.content_hash, headingOffset: 1 })
          : null,
    };
  }

  async listDashboardArtifactVersions(
    artifactId: string
  ): Promise<DashboardArtifactVersionViewModel[]> {
    const sql = `
      SELECT av.*, b.name AS bot_name
      FROM artifact_versions av
      LEFT JOIN bots b ON b.id = av.created_by_bot
      WHERE av.artifact_id = ?
      ORDER BY av.version_num DESC
    `;
    const rows =
      this.db.dialect === 'sqlite'
        ? (this.db.sqlite.prepare(sql).all(artifactId) as VersionQueryRow[])
        : (await pgQuery<VersionQueryRow>(this.db.pool, sql, [artifactId])).rows;
    return rows.map((row) => ({
      versionNum: row.version_num,
      type: row.type,
      title: row.title,
      content: row.content,
      contentHash: row.content_hash,
      changeSummary: row.change_summary,
      restoredFromVersion: row.restored_from_version,
      createdByBotName: row.bot_name,
      createdAt: row.created_at,
    }));
  }

  async listDashboardTemplates(accountId: string): Promise<DashboardTemplateViewModel[]> {
    const sql = `
      SELECT *
      FROM templates
      WHERE account_id IS NULL OR account_id = ?
      ORDER BY account_id IS NOT NULL, name ASC
    `;
    const rows =
      this.db.dialect === 'sqlite'
        ? (this.db.sqlite.prepare(sql).all(accountId) as TemplateQueryRow[])
        : (await pgQuery<TemplateQueryRow>(this.db.pool, sql, [accountId])).rows;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      thumbnailUrl: row.thumbnail_url,
      type: row.type,
      slots: parseTemplateSlots(row.slots),
      builtIn: row.account_id === null,
    }));
  }

  private async artifactListItemFromRow(
    row: ArtifactQueryRow,
    retentionDays: number | null
  ): Promise<DashboardArtifactListViewModel> {
    const aggregate = await shareAggregate(this.db, row.id);
    const retentionExpiresAt =
      retentionDays === null ? null : row.updated_at + retentionDays * dayMs;
    const activeShare = row.share_id
      ? {
          id: row.share_id,
          url: `${this.options.baseUrl}/a/${row.share_id}`,
          passwordProtected: row.share_password_hash !== null,
          viewCount: row.share_view_count ?? 0,
          uniqueViewerCount: row.share_unique_viewer_count ?? 0,
          lastViewedAt: row.share_last_viewed_at,
          createdAt: row.share_created_at ?? row.created_at,
          revokedAt: row.share_revoked_at,
        }
      : null;
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      type: row.type,
      updatedAt: row.updated_at,
      botName: row.bot_name,
      botByline: row.bot_byline,
      activeShare,
      lifetimeViews: Number(aggregate.lifetime_views ?? activeShare?.viewCount ?? 0),
      previousShareCount: Number(aggregate.previous_share_count ?? 0),
      expiresAt: row.share_expires_at ?? retentionExpiresAt,
    };
  }
}

function artifactSelectSql(where: string, suffix: string): string {
  return `
    SELECT
      a.id, a.account_id, a.slug, a.type, a.title, a.content, a.content_hash,
      a.version_num, a.updated_at, a.created_at, a.created_by_bot,
      b.name AS bot_name, b.byline AS bot_byline,
      s.id AS share_id, s.password_hash AS share_password_hash,
      s.expires_at AS share_expires_at, s.revoked_at AS share_revoked_at,
      s.view_count AS share_view_count, s.unique_viewer_count AS share_unique_viewer_count,
      s.last_viewed_at AS share_last_viewed_at, s.created_at AS share_created_at
    FROM artifacts a
    LEFT JOIN bots b ON b.id = a.created_by_bot
    LEFT JOIN shares s ON s.artifact_id = a.id AND s.revoked_at IS NULL
    WHERE ${where}
    ${suffix}
  `;
}

async function queryArtifacts(
  db: DatabaseHandle,
  sql: string,
  params: unknown[]
): Promise<ArtifactQueryRow[]> {
  if (db.dialect === 'sqlite') {
    return db.sqlite.prepare(sql).all(...params) as ArtifactQueryRow[];
  }

  return (await pgQuery<ArtifactQueryRow>(db.pool, sql, params)).rows;
}

async function shareAggregate(db: DatabaseHandle, artifactId: string): Promise<ShareAggregateRow> {
  const sql = `
    SELECT
      COALESCE(SUM(view_count), 0) AS lifetime_views,
      COALESCE(SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS previous_share_count
    FROM shares
    WHERE artifact_id = ?
  `;
  if (db.dialect === 'sqlite') {
    return db.sqlite.prepare(sql).get(artifactId) as ShareAggregateRow;
  }

  const result = await pgQuery<ShareAggregateRow>(db.pool, sql, [artifactId]);
  return result.rows[0] ?? { lifetime_views: 0, previous_share_count: 0 };
}

async function pgQuery<T extends QueryResultRow>(
  executor: PostgresDatabaseHandle['pool'],
  sql: string,
  params: unknown[]
): Promise<QueryResult<T>> {
  let index = 0;
  return executor.query<T>(
    sql.replace(/\?/g, () => `$${++index}`),
    params
  );
}

function scalarQuery(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function parseTemplateSlots(slotsJson: string): string[] {
  try {
    const value = JSON.parse(slotsJson) as Array<string | { name?: string }>;
    return value
      .map((slot) => (typeof slot === 'string' ? slot : (slot.name ?? '')))
      .filter((slot) => slot.length > 0);
  } catch {
    return [];
  }
}

function encodeCursor(row: ArtifactQueryRow | undefined): string | null {
  if (!row) {
    return null;
  }
  return Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id })).toString(
    'base64url'
  );
}

function decodeCursor(value: string): { updatedAt: number; id: string } | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.updatedAt === 'number' && typeof parsed.id === 'string') {
      return { updatedAt: parsed.updatedAt, id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
}
