import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import type { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from '../db/client.js';
import type { Account, ArtifactEvent, CloudModule, Plan } from '../extension/cloud-module.js';
import { renderMarkdown } from '../lib/markdown.js';
import { buildOgDescription } from '../lib/og.js';
import type { Logger } from '../logger.js';
import type { ArtifactType } from './artifacts.js';
import { ServiceError } from './errors.js';

export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const VIEWER_ID_PATTERN = /^[0-9a-f-]{16,50}$/i;
export const SHARE_ACCESS_TTL_MS = 15 * 60 * 1000;
export const VIEWER_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
export const VIEW_THROTTLE_MS = 10 * 1000;
export const SHARE_VIEWER_UNIQUE_CAP = 50_000;

export interface ViewerServiceOptions {
  db: DatabaseHandle;
  config: AppConfig;
  cloudModule: CloudModule;
  logger?: Logger;
  now?: () => number;
}

export interface ViewerBotRef {
  name: string;
  byline: string | null;
}

export interface ViewerContentResult {
  shareId: string;
  accountId: string;
  artifactId: string;
  slug: string;
  type: ArtifactType;
  title: string;
  content: string;
  contentHash: string;
  versionNum: number;
  latestVersionNum: number;
  updatedAt: number;
  bot: ViewerBotRef | null;
  passwordProtected: boolean;
  footer: boolean;
  html: string | null;
  frameUrl: string | null;
}

export interface ViewerPageModel {
  shareId: string;
  canonicalUrl: string;
  passwordProtected: boolean;
  footer: boolean;
  meta: ViewerMeta;
  initialContent: ViewerContentResult | null;
}

export interface ViewerMeta {
  title: string;
  description: string;
  imageUrl: string;
  canonicalUrl: string;
  protected: boolean;
}

export interface ViewerPasswordSuccess {
  ok: true;
  viewerToken: string;
  expiresAt: number;
}

export interface ViewerRecordViewInput {
  shareId: string;
  artifactId: string;
  accountId: string;
  viewerId: string;
}

interface ShareContext {
  shareId: string;
  artifactId: string;
  passwordHash: string | null;
  passwordUpdatedAt: number | null;
  shareExpiresAt: number | null;
  artifact: ArtifactHead;
  account: Account;
  accountEmail: string;
  bot: ViewerBotRef | null;
  plan: Plan;
}

interface ArtifactHead {
  id: string;
  accountId: string;
  slug: string;
  type: ArtifactType;
  title: string;
  content: string;
  contentHash: string;
  versionNum: number;
  createdByBot: string | null;
  deletedAt: number | null;
  updatedAt: number;
}

interface ContentSource {
  type: ArtifactType;
  title: string;
  content: string;
  contentHash: string;
  versionNum: number;
  updatedAt: number;
  bot: ViewerBotRef | null;
}

interface ShareResolutionRow {
  share_id: string;
  share_artifact_id: string;
  password_hash: string | null;
  password_updated_at: number | null;
  share_expires_at: number | null;
  revoked_at: number | null;
  artifact_id: string | null;
  artifact_account_id: string | null;
  slug: string | null;
  artifact_type: ArtifactType | null;
  title: string | null;
  content: string | null;
  content_hash: string | null;
  version_num: number | null;
  created_by_bot: string | null;
  deleted_at: number | null;
  artifact_updated_at: number | null;
  account_id: string | null;
  email: string | null;
  suspended_at: number | null;
  bot_id: string | null;
  bot_name: string | null;
  bot_byline: string | null;
}

interface VersionRow {
  type: ArtifactType;
  title: string;
  content: string;
  content_hash: string;
  version_num: number;
  created_at: number;
  bot_id: string | null;
  bot_name: string | null;
  bot_byline: string | null;
}

interface ShareViewerRow {
  last_viewed_at: number;
}

export class ViewerService {
  private readonly db: DatabaseHandle;
  private readonly config: AppConfig;
  private readonly cloudModule: CloudModule;
  private readonly logger?: Logger;
  private readonly now: () => number;
  private readonly recentViews = new Map<string, number>();

  constructor(options: ViewerServiceOptions) {
    this.db = options.db;
    this.config = options.config;
    this.cloudModule = options.cloudModule;
    if (options.logger) {
      this.logger = options.logger;
    }
    this.now = options.now ?? Date.now;
  }

  async getPageModel(shareId: string, versionNum?: number): Promise<ViewerPageModel> {
    const share = await this.resolveShare(shareId);
    const canonicalUrl = this.shareUrl(shareId);

    if (share.passwordHash) {
      return {
        shareId,
        canonicalUrl,
        passwordProtected: true,
        footer: share.plan.showFooter,
        meta: protectedMeta(canonicalUrl, this.ogImageUrl(shareId)),
        initialContent: null,
      };
    }

    const content = await this.readContentFromShare(share, versionNum, null);
    return {
      shareId,
      canonicalUrl,
      passwordProtected: false,
      footer: share.plan.showFooter,
      meta: publicMeta(content, canonicalUrl, this.ogImageUrl(shareId)),
      initialContent: content,
    };
  }

  async getContent(
    shareId: string,
    options: { versionNum?: number | undefined; viewerToken?: string | null } = {}
  ): Promise<ViewerContentResult> {
    const share = await this.resolveShare(shareId);
    this.assertShareAccess(share, options.viewerToken ?? null);
    return this.readContentFromShare(share, options.versionNum, options.viewerToken ?? null);
  }

  async getDownload(
    shareId: string,
    options: { versionNum?: number | undefined; viewerToken?: string | null } = {}
  ): Promise<ViewerContentResult> {
    return this.getContent(shareId, options);
  }

  async verifyPassword(shareId: string, password: string): Promise<ViewerPasswordSuccess> {
    const share = await this.resolveShare(shareId);
    if (!share.passwordHash) {
      throw new ServiceError(400, 'validation_failed', 'Share is not password-protected');
    }

    const valid = await argon2.verify(share.passwordHash, password);
    if (!valid) {
      throw new ServiceError(401, 'password_invalid', 'Incorrect password');
    }

    const expiresAt = this.now() + SHARE_ACCESS_TTL_MS;
    return {
      ok: true,
      viewerToken: this.signShareAccessToken(share.shareId, share.passwordUpdatedAt, expiresAt),
      expiresAt,
    };
  }

  async getOgModel(shareId: string): Promise<{
    shareId: string;
    contentHash: string;
    title: string;
    bot: ViewerBotRef | null;
  }> {
    const share = await this.resolveShare(shareId);

    if (share.passwordHash) {
      return {
        shareId,
        contentHash: `protected:${shareId}`,
        title: 'Protected artifact',
        bot: null,
      };
    }

    return {
      shareId,
      contentHash: share.artifact.contentHash,
      title: share.artifact.title,
      bot: share.bot,
    };
  }

  async recordView(input: ViewerRecordViewInput): Promise<boolean> {
    const now = this.now();
    const throttleKey = `${input.shareId}\0${input.viewerId}`;
    const lastSeen = this.recentViews.get(throttleKey);
    if (lastSeen !== undefined && now - lastSeen < VIEW_THROTTLE_MS) {
      return false;
    }

    const counted =
      this.db.dialect === 'sqlite'
        ? this.recordSqliteView(input, now)
        : await this.recordPostgresView(input, now);

    if (counted) {
      this.recentViews.set(throttleKey, now);
      this.pruneRecentViews(now);
      this.emitEvent({
        type: 'share.viewed',
        accountId: input.accountId,
        artifactId: input.artifactId,
        shareId: input.shareId,
        at: new Date(now).toISOString(),
      });
    }

    return counted;
  }

  mintViewerId(): string {
    return randomUUID();
  }

  isValidViewerId(value: string | undefined): value is string {
    return Boolean(value && VIEWER_ID_PATTERN.test(value));
  }

  signShareAccessToken(
    shareId: string,
    passwordUpdatedAt: number | null,
    expiresAt: number
  ): string {
    const exp = Math.floor(expiresAt);
    const mac = this.shareAccessMac(shareId, passwordUpdatedAt, exp);
    return `${exp}.${mac}`;
  }

  verifyShareAccessToken(
    token: string | null | undefined,
    shareId: string,
    passwordUpdatedAt: number | null
  ): boolean {
    if (!token) {
      return false;
    }

    const [expRaw, mac, extra] = token.split('.');
    if (!expRaw || !mac || extra !== undefined || !/^[0-9]+$/.test(expRaw)) {
      return false;
    }

    const exp = Number(expRaw);
    if (!Number.isSafeInteger(exp) || exp <= this.now()) {
      return false;
    }

    const expected = this.shareAccessMac(shareId, passwordUpdatedAt, exp);
    return timingSafeEqualHex(mac, expected);
  }

  private async resolveShare(shareId: string): Promise<ShareContext> {
    if (!SHARE_ID_PATTERN.test(shareId)) {
      throw new ServiceError(404, 'not_found', 'Not found');
    }

    const row = await this.getShareResolutionRow(shareId);
    if (!row) {
      throw new ServiceError(404, 'not_found', 'Not found');
    }

    const now = this.now();
    if (row.revoked_at !== null) {
      throw new ServiceError(410, 'share_revoked', 'This share link has been revoked');
    }

    if (row.share_expires_at !== null && row.share_expires_at <= now) {
      throw new ServiceError(410, 'share_expired', 'This share link has expired');
    }

    if (!row.artifact_id) {
      throw new ServiceError(410, 'share_revoked', 'This share link has been revoked');
    }

    if (!row.account_id || !row.email) {
      throw new ServiceError(404, 'not_found', 'Not found');
    }

    const artifact = artifactFromResolutionRow(row);
    if (artifact.deletedAt !== null) {
      throw new ServiceError(410, 'share_revoked', 'This share link has been revoked');
    }

    const account: Account = {
      id: row.account_id,
      email: row.email,
      suspendedAt: row.suspended_at,
    };
    if (account.suspendedAt !== null) {
      // Not `share_revoked`: the owner did not revoke anything, and reusing that code made the
      // public page tell recipients a false cause. Still 410 — from the reader's side the resource
      // is genuinely gone — but with a code the terminal copy can tell apart.
      throw new ServiceError(410, 'share_disabled', 'This share link is no longer available');
    }

    const plan = await this.cloudModule.resolvePlan(account);
    if (this.isArtifactExpired(artifact, plan, now)) {
      throw new ServiceError(410, 'share_revoked', 'This artifact has expired');
    }

    return {
      shareId: row.share_id,
      artifactId: row.share_artifact_id,
      passwordHash: row.password_hash,
      passwordUpdatedAt: row.password_updated_at,
      shareExpiresAt: row.share_expires_at,
      artifact,
      account,
      accountEmail: row.email,
      bot: botFromParts(row.bot_id, row.bot_name, row.bot_byline),
      plan,
    };
  }

  private async readContentFromShare(
    share: ShareContext,
    versionNum: number | undefined,
    viewerToken: string | null
  ): Promise<ViewerContentResult> {
    const source = versionNum
      ? await this.getVersionSource(share.artifact.id, versionNum)
      : latestSource(share);

    if (!source) {
      throw new ServiceError(404, 'not_found', 'Artifact version not found');
    }

    const html =
      source.type === 'markdown'
        ? renderMarkdown(source.content, { contentHash: source.contentHash })
        : null;

    const frameUrl =
      source.type === 'html'
        ? this.frameUrl({
            shareId: share.shareId,
            contentHash: source.contentHash,
            versionNum,
            viewerToken: share.passwordHash ? viewerToken : null,
          })
        : null;

    return {
      shareId: share.shareId,
      accountId: share.account.id,
      artifactId: share.artifact.id,
      slug: share.artifact.slug,
      type: source.type,
      title: source.title,
      content: source.content,
      contentHash: source.contentHash,
      versionNum: source.versionNum,
      latestVersionNum: share.artifact.versionNum,
      updatedAt: source.updatedAt,
      bot: source.bot,
      passwordProtected: share.passwordHash !== null,
      footer: share.plan.showFooter,
      html,
      frameUrl,
    };
  }

  private assertShareAccess(share: ShareContext, viewerToken: string | null): void {
    if (!share.passwordHash) {
      return;
    }

    if (this.verifyShareAccessToken(viewerToken, share.shareId, share.passwordUpdatedAt)) {
      return;
    }

    throw new ServiceError(401, 'password_required', 'Password required');
  }

  private async getShareResolutionRow(shareId: string): Promise<ShareResolutionRow | null> {
    if (this.db.dialect === 'sqlite') {
      return getSqliteShareResolutionRow(this.db, shareId);
    }

    return getPostgresShareResolutionRow(this.db.pool, shareId);
  }

  private async getVersionSource(
    artifactId: string,
    versionNum: number
  ): Promise<ContentSource | null> {
    if (this.db.dialect === 'sqlite') {
      return getSqliteVersionSource(this.db, artifactId, versionNum);
    }

    return getPostgresVersionSource(this.db.pool, artifactId, versionNum);
  }

  /**
   * PRD §7.2.8 write path. Both dialects run the same three conflict-free steps so a
   * concurrent first view can never raise a duplicate-key error on the public reader:
   *
   *   1. Throttled UPDATE — counts a repeat view only when the ledger row is older than
   *      the throttle window. Matching zero rows means "absent or throttled".
   *   2. Capped INSERT with `ON CONFLICT DO NOTHING` — adds the ledger row when the share
   *      is under the unique-viewer cap. A racing writer that already inserted the row
   *      makes this a no-op instead of a `23505`.
   *   3. Existence probe — the only way to tell the two zero-row outcomes apart. A row
   *      means step 1 was throttled (not counted); no row means the share is at the
   *      unique-viewer cap, which still counts a view but never a new unique viewer.
   */
  private recordSqliteView(input: ViewerRecordViewInput, now: number): boolean {
    const handle = this.db as SqliteDatabaseHandle;
    const countableBefore = now - VIEW_THROTTLE_MS;

    const transaction = handle.sqlite.transaction(() => {
      const touched = handle.sqlite
        .prepare(
          `
            UPDATE share_viewers
            SET view_count = view_count + 1, last_viewed_at = ?
            WHERE share_id = ? AND viewer_id = ? AND last_viewed_at <= ?
          `
        )
        .run(now, input.shareId, input.viewerId, countableBefore);

      if (touched.changes > 0) {
        incrementSqliteShareView(handle, input.shareId, now, false);
        return true;
      }

      const inserted = handle.sqlite
        .prepare(
          `
            INSERT INTO share_viewers (
              share_id, viewer_id, first_viewed_at, last_viewed_at, view_count
            )
            SELECT ?, ?, ?, ?, 1
            WHERE (SELECT COUNT(*) FROM share_viewers WHERE share_id = ?) < ?
            ON CONFLICT (share_id, viewer_id) DO NOTHING
          `
        )
        .run(input.shareId, input.viewerId, now, now, input.shareId, SHARE_VIEWER_UNIQUE_CAP);

      if (inserted.changes > 0) {
        incrementSqliteShareView(handle, input.shareId, now, true);
        return true;
      }

      const existing = handle.sqlite
        .prepare('SELECT last_viewed_at FROM share_viewers WHERE share_id = ? AND viewer_id = ?')
        .get(input.shareId, input.viewerId) as ShareViewerRow | undefined;

      if (existing) {
        return false;
      }

      incrementSqliteShareView(handle, input.shareId, now, false);
      return true;
    });

    return transaction.immediate();
  }

  private async recordPostgresView(input: ViewerRecordViewInput, now: number): Promise<boolean> {
    const handle = this.db as PostgresDatabaseHandle;
    const countableBefore = now - VIEW_THROTTLE_MS;
    const client = await handle.pool.connect();

    try {
      await client.query('BEGIN');

      const touched = await client.query(
        `
          UPDATE share_viewers
          SET view_count = view_count + 1, last_viewed_at = $1
          WHERE share_id = $2 AND viewer_id = $3 AND last_viewed_at <= $4
        `,
        [now, input.shareId, input.viewerId, countableBefore]
      );

      if ((touched.rowCount ?? 0) > 0) {
        await incrementPostgresShareView(client, input.shareId, now, false);
        await client.query('COMMIT');
        return true;
      }

      const inserted = await client.query(
        `
          INSERT INTO share_viewers (
            share_id, viewer_id, first_viewed_at, last_viewed_at, view_count
          )
          SELECT $1::text, $2::text, $3::bigint, $3::bigint, 1
          WHERE (SELECT COUNT(*) FROM share_viewers WHERE share_id = $1) < $4
          ON CONFLICT (share_id, viewer_id) DO NOTHING
        `,
        [input.shareId, input.viewerId, now, SHARE_VIEWER_UNIQUE_CAP]
      );

      if ((inserted.rowCount ?? 0) > 0) {
        await incrementPostgresShareView(client, input.shareId, now, true);
        await client.query('COMMIT');
        return true;
      }

      const existing = await client.query<ShareViewerRow>(
        'SELECT last_viewed_at FROM share_viewers WHERE share_id = $1 AND viewer_id = $2',
        [input.shareId, input.viewerId]
      );

      if ((existing.rowCount ?? 0) > 0) {
        await client.query('COMMIT');
        return false;
      }

      await incrementPostgresShareView(client, input.shareId, now, false);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private shareAccessMac(
    shareId: string,
    passwordUpdatedAt: number | null,
    expiresAt: number
  ): string {
    return createHmac('sha256', this.config.sessionSecret)
      .update(`${shareId}|${passwordUpdatedAt ?? 0}|${expiresAt}`)
      .digest('hex');
  }

  private frameUrl(input: {
    shareId: string;
    contentHash: string;
    versionNum?: number | undefined;
    viewerToken: string | null;
  }): string {
    const url = new URL(
      `/a/${input.shareId}/frame`,
      this.config.sandboxOrigin ?? this.config.baseUrl
    );
    url.searchParams.set('h', input.contentHash);
    if (input.versionNum) {
      url.searchParams.set('v', String(input.versionNum));
    }
    if (input.viewerToken) {
      url.searchParams.set('t', input.viewerToken);
    }
    return url.toString();
  }

  private shareUrl(shareId: string): string {
    return new URL(`/a/${shareId}`, this.config.baseUrl).toString();
  }

  private ogImageUrl(shareId: string): string {
    return new URL(`/a/${shareId}/og.png`, this.config.baseUrl).toString();
  }

  private isArtifactExpired(artifact: ArtifactHead, plan: Plan, now: number): boolean {
    if (plan.artifact_retention_days === null) {
      return false;
    }

    const retentionMs = plan.artifact_retention_days * 24 * 60 * 60 * 1000;
    return artifact.updatedAt + retentionMs <= now;
  }

  private pruneRecentViews(now: number): void {
    if (this.recentViews.size < 10_000) {
      return;
    }

    for (const [key, lastSeen] of this.recentViews) {
      if (now - lastSeen >= VIEW_THROTTLE_MS) {
        this.recentViews.delete(key);
      }
    }
  }

  private emitEvent(event: ArtifactEvent): void {
    try {
      this.cloudModule.onArtifactEvent?.(event);
    } catch (error) {
      this.logger?.warn({ err: error, event_type: event.type }, 'extension.artifact_event_failed');
    }
  }
}

function getSqliteShareResolutionRow(
  handle: SqliteDatabaseHandle,
  shareId: string
): ShareResolutionRow | null {
  return (
    (handle.sqlite
      .prepare(
        `
          SELECT
            s.id AS share_id,
            s.artifact_id AS share_artifact_id,
            s.password_hash,
            s.password_updated_at,
            s.expires_at AS share_expires_at,
            s.revoked_at,
            a.id AS artifact_id,
            a.account_id AS artifact_account_id,
            a.slug,
            a.type AS artifact_type,
            a.title,
            a.content,
            a.content_hash,
            a.version_num,
            a.created_by_bot,
            a.deleted_at,
            a.updated_at AS artifact_updated_at,
            acc.id AS account_id,
            acc.email,
            acc.suspended_at,
            b.id AS bot_id,
            b.name AS bot_name,
            b.byline AS bot_byline
          FROM shares s
          LEFT JOIN artifacts a ON a.id = s.artifact_id
          LEFT JOIN accounts acc ON acc.id = a.account_id
          LEFT JOIN bots b ON b.id = a.created_by_bot
          WHERE s.id = ?
        `
      )
      .get(shareId) as ShareResolutionRow | undefined) ?? null
  );
}

async function getPostgresShareResolutionRow(
  executor: Pool | PoolClient,
  shareId: string
): Promise<ShareResolutionRow | null> {
  const result = await executor.query<ShareResolutionRow>(
    `
      SELECT
        s.id AS share_id,
        s.artifact_id AS share_artifact_id,
        s.password_hash,
        s.password_updated_at,
        s.expires_at AS share_expires_at,
        s.revoked_at,
        a.id AS artifact_id,
        a.account_id AS artifact_account_id,
        a.slug,
        a.type AS artifact_type,
        a.title,
        a.content,
        a.content_hash,
        a.version_num,
        a.created_by_bot,
        a.deleted_at,
        a.updated_at AS artifact_updated_at,
        acc.id AS account_id,
        acc.email,
        acc.suspended_at,
        b.id AS bot_id,
        b.name AS bot_name,
        b.byline AS bot_byline
      FROM shares s
      LEFT JOIN artifacts a ON a.id = s.artifact_id
      LEFT JOIN accounts acc ON acc.id = a.account_id
      LEFT JOIN bots b ON b.id = a.created_by_bot
      WHERE s.id = $1
    `,
    [shareId]
  );
  return result.rows[0] ?? null;
}

function getSqliteVersionSource(
  handle: SqliteDatabaseHandle,
  artifactId: string,
  versionNum: number
): ContentSource | null {
  const row = handle.sqlite
    .prepare(
      `
        SELECT
          v.type,
          v.title,
          v.content,
          v.content_hash,
          v.version_num,
          v.created_at,
          b.id AS bot_id,
          b.name AS bot_name,
          b.byline AS bot_byline
        FROM artifact_versions v
        LEFT JOIN bots b ON b.id = v.created_by_bot
        WHERE v.artifact_id = ? AND v.version_num = ?
      `
    )
    .get(artifactId, versionNum) as VersionRow | undefined;

  return row ? versionSourceFromRow(row) : null;
}

async function getPostgresVersionSource(
  executor: Pool | PoolClient,
  artifactId: string,
  versionNum: number
): Promise<ContentSource | null> {
  const result = await executor.query<VersionRow>(
    `
      SELECT
        v.type,
        v.title,
        v.content,
        v.content_hash,
        v.version_num,
        v.created_at,
        b.id AS bot_id,
        b.name AS bot_name,
        b.byline AS bot_byline
      FROM artifact_versions v
      LEFT JOIN bots b ON b.id = v.created_by_bot
      WHERE v.artifact_id = $1 AND v.version_num = $2
    `,
    [artifactId, versionNum]
  );
  const row = result.rows[0];
  return row ? versionSourceFromRow(row) : null;
}

function incrementSqliteShareView(
  handle: SqliteDatabaseHandle,
  shareId: string,
  now: number,
  incrementUnique: boolean
): void {
  handle.sqlite
    .prepare(
      `
        UPDATE shares
        SET view_count = view_count + 1,
            unique_viewer_count = unique_viewer_count + ?,
            last_viewed_at = ?
        WHERE id = ?
      `
    )
    .run(incrementUnique ? 1 : 0, now, shareId);
}

async function incrementPostgresShareView(
  client: PoolClient,
  shareId: string,
  now: number,
  incrementUnique: boolean
): Promise<void> {
  await client.query(
    `
      UPDATE shares
      SET view_count = view_count + 1,
          unique_viewer_count = unique_viewer_count + $1,
          last_viewed_at = $2
      WHERE id = $3
    `,
    [incrementUnique ? 1 : 0, now, shareId]
  );
}

function artifactFromResolutionRow(row: ShareResolutionRow): ArtifactHead {
  if (
    !row.artifact_id ||
    !row.artifact_account_id ||
    !row.slug ||
    !row.artifact_type ||
    !row.title ||
    row.content === null ||
    !row.content_hash ||
    row.version_num === null ||
    row.artifact_updated_at === null
  ) {
    throw new ServiceError(410, 'share_revoked', 'This share link has been revoked');
  }

  return {
    id: row.artifact_id,
    accountId: row.artifact_account_id,
    slug: row.slug,
    type: row.artifact_type,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    versionNum: row.version_num,
    createdByBot: row.created_by_bot,
    deletedAt: row.deleted_at,
    updatedAt: row.artifact_updated_at,
  };
}

function latestSource(share: ShareContext): ContentSource {
  return {
    type: share.artifact.type,
    title: share.artifact.title,
    content: share.artifact.content,
    contentHash: share.artifact.contentHash,
    versionNum: share.artifact.versionNum,
    updatedAt: share.artifact.updatedAt,
    bot: share.bot,
  };
}

function versionSourceFromRow(row: VersionRow): ContentSource {
  return {
    type: row.type,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    versionNum: row.version_num,
    updatedAt: row.created_at,
    bot: botFromParts(row.bot_id, row.bot_name, row.bot_byline),
  };
}

function botFromParts(
  id: string | null,
  name: string | null,
  byline: string | null
): ViewerBotRef | null {
  if (!id || !name) {
    return null;
  }

  return { name, byline };
}

function publicMeta(
  content: ViewerContentResult,
  canonicalUrl: string,
  imageUrl: string
): ViewerMeta {
  return {
    title: content.title,
    description: buildOgDescription({ type: content.type, content: content.content }),
    imageUrl,
    canonicalUrl,
    protected: false,
  };
}

function protectedMeta(canonicalUrl: string, imageUrl: string): ViewerMeta {
  return {
    title: 'Protected artifact',
    description: 'A password-protected artifact on Agent Artifacts',
    imageUrl,
    canonicalUrl,
    protected: true,
  };
}

function timingSafeEqualHex(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actual) || actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
