import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { Pool, PoolClient } from 'pg';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from '../db/client.js';
import type { Account, ArtifactEvent, CloudModule } from '../extension/cloud-module.js';
import type { Logger } from '../logger.js';
import { ServiceError } from './errors.js';

export type ArtifactType = 'markdown' | 'html';
export type ArtifactWriteMode = 'created' | 'updated' | 'unchanged';

export interface BotRef {
  id: string;
  name?: string;
  byline?: string | null;
}

export interface UpsertArtifactInput {
  account: Account;
  bot?: BotRef | null;
  slug: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  changeSummary?: string | null;
  share?: boolean;
  passwordHash?: string | null;
  templateSlug?: string | null;
}

export interface RestoreArtifactInput {
  account: Account;
  bot?: BotRef | null;
  artifactId: string;
  versionNum: number;
  changeSummary?: string | null;
}

export interface SoftDeleteArtifactInput {
  account: Account;
  artifactId: string;
}

export interface ArtifactSnapshot {
  id: string;
  accountId: string;
  slug: string;
  type: ArtifactType;
  title: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  versionNum: number;
  createdByBot: string | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactVersionSnapshot {
  artifactId: string;
  versionNum: number;
  type: ArtifactType;
  title: string;
  content: string;
  contentHash: string;
  changeSummary: string | null;
  restoredFromVersion: number | null;
  createdByBot: string | null;
  createdAt: number;
}

export interface ShareSnapshot {
  shareId: string;
  url: string;
  passwordProtected: boolean;
  passwordUpdatedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
  viewCount: number;
  uniqueViewerCount: number;
  lastViewedAt: number | null;
  createdAt: number;
}

export interface ArtifactWriteResult {
  mode: ArtifactWriteMode;
  artifact: ArtifactSnapshot;
  share: ShareSnapshot | null;
}

export interface SoftDeleteArtifactResult {
  deleted: boolean;
  revokedShareCount: number;
}

export interface ArtifactServiceOptions {
  db: DatabaseHandle;
  extension: CloudModule;
  baseUrl?: string;
  logger?: Logger;
  now?: () => number;
}

interface ArtifactDbRow {
  id: string;
  account_id: string;
  slug: string;
  type: ArtifactType;
  title: string;
  content: string;
  content_hash: string;
  metadata: string;
  version_num: number;
  created_by_bot: string | null;
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ArtifactVersionDbRow {
  artifact_id: string;
  version_num: number;
  type: ArtifactType;
  title: string;
  content: string;
  content_hash: string;
  change_summary: string | null;
  restored_from_version: number | null;
  created_by_bot: string | null;
  created_at: number;
}

interface ShareDbRow {
  id: string;
  artifact_id: string;
  password_hash: string | null;
  password_updated_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
  view_count: number;
  unique_viewer_count: number;
  last_viewed_at: number | null;
  created_at: number;
}

interface PendingShareEvent {
  accountId: string;
  artifactId: string;
  shareId: string;
}

interface TransactionOutcome extends ArtifactWriteResult {
  events: ArtifactEvent[];
}

class VersionQuotaRequired extends Error {
  constructor(readonly artifactId: string) {
    super('Version quota must be checked before retrying this write');
    this.name = 'VersionQuotaRequired';
  }
}

export function computeContentHash(type: ArtifactType, title: string, content: string): string {
  return createHash('sha256').update(`${type}\0${title}\0${content}`).digest('hex');
}

export class ArtifactService {
  private readonly db: DatabaseHandle;
  private readonly extension: CloudModule;
  private readonly baseUrl: string;
  private readonly logger?: Logger;
  private readonly now: () => number;

  constructor(options: ArtifactServiceOptions) {
    this.db = options.db;
    this.extension = options.extension;
    this.baseUrl = options.baseUrl ?? 'http://localhost:3000';
    if (options.logger) {
      this.logger = options.logger;
    }
    this.now = options.now ?? Date.now;
  }

  async upsertArtifact(input: UpsertArtifactInput): Promise<ArtifactWriteResult> {
    await this.enforceUseTemplate(input);
    await this.enforceSetSharePassword(input);

    const contentHash = computeContentHash(input.type, input.title, input.content);
    const contentBytes = Buffer.byteLength(input.content, 'utf8');
    const existing = await this.findLiveArtifactBySlug(input.account.id, input.slug);

    if (!existing) {
      const artifactId = `art_${nanoid(21)}`;
      await this.enforceQuota(input.account, { type: 'create_artifact' });
      await this.enforceQuota(input.account, {
        type: 'create_version',
        artifact_id: artifactId,
        content_bytes: contentBytes,
      });

      try {
        return this.emitOutcome(
          await this.createArtifact(
            input,
            artifactId,
            contentHash,
            serializeMetadata(input.metadata)
          )
        );
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
      }
    } else if (existing.content_hash !== contentHash) {
      await this.enforceQuota(input.account, {
        type: 'create_version',
        artifact_id: existing.id,
        content_bytes: contentBytes,
      });
      return this.emitOutcome(
        await this.updateArtifact(input, contentHash, true, serializeMetadata(input.metadata))
      );
    }

    try {
      return this.emitOutcome(
        await this.updateArtifact(input, contentHash, false, serializeMetadata(input.metadata))
      );
    } catch (error) {
      if (!(error instanceof VersionQuotaRequired)) {
        throw error;
      }

      await this.enforceQuota(input.account, {
        type: 'create_version',
        artifact_id: error.artifactId,
        content_bytes: contentBytes,
      });
      return this.emitOutcome(
        await this.updateArtifact(input, contentHash, true, serializeMetadata(input.metadata))
      );
    }
  }

  async restoreVersion(input: RestoreArtifactInput): Promise<ArtifactWriteResult> {
    const existing = await this.findLiveArtifactById(input.account.id, input.artifactId);
    if (!existing) {
      throw new ServiceError(404, 'not_found', 'Artifact not found');
    }

    const source = await this.findVersion(input.artifactId, input.versionNum);
    if (!source) {
      throw new ServiceError(404, 'not_found', 'Artifact version not found');
    }

    if (existing.version_num === input.versionNum) {
      throw new ServiceError(400, 'validation_failed', 'Cannot restore the current version', {
        reason: 'already_current',
      });
    }

    await this.enforceQuota(input.account, {
      type: 'create_version',
      artifact_id: input.artifactId,
      content_bytes: Buffer.byteLength(source.content, 'utf8'),
    });

    const outcome =
      this.db.dialect === 'sqlite'
        ? this.restoreSqlite(input, source)
        : await this.restorePostgres(input, source);

    return this.emitOutcome(outcome);
  }

  async softDeleteArtifact(input: SoftDeleteArtifactInput): Promise<SoftDeleteArtifactResult> {
    const outcome =
      this.db.dialect === 'sqlite'
        ? this.softDeleteSqlite(input)
        : await this.softDeletePostgres(input);

    for (const event of outcome.events) {
      this.emitEvent(event);
    }

    return {
      deleted: outcome.deleted,
      revokedShareCount: outcome.revokedShareCount,
    };
  }

  async getArtifactBySlug(accountId: string, slug: string): Promise<ArtifactSnapshot | null> {
    const row = await this.findLiveArtifactBySlug(accountId, slug);
    return row ? artifactFromRow(row) : null;
  }

  async getArtifactById(accountId: string, artifactId: string): Promise<ArtifactSnapshot | null> {
    const row = await this.findLiveArtifactById(accountId, artifactId);
    return row ? artifactFromRow(row) : null;
  }

  async getActiveShare(artifactId: string): Promise<ShareSnapshot | null> {
    const row = await this.findActiveShare(artifactId);
    return row ? shareFromRow(row, this.baseUrl) : null;
  }

  async listVersions(artifactId: string): Promise<ArtifactVersionSnapshot[]> {
    if (this.db.dialect === 'sqlite') {
      const rows = this.db.sqlite
        .prepare(
          `
            SELECT *
            FROM artifact_versions
            WHERE artifact_id = ?
            ORDER BY version_num ASC
          `
        )
        .all(artifactId) as ArtifactVersionDbRow[];
      return rows.map(versionFromRow);
    }

    const result = await this.db.pool.query<ArtifactVersionDbRow>(
      `
        SELECT *
        FROM artifact_versions
        WHERE artifact_id = $1
        ORDER BY version_num ASC
      `,
      [artifactId]
    );
    return result.rows.map(versionFromRow);
  }

  private async createArtifact(
    input: UpsertArtifactInput,
    artifactId: string,
    contentHash: string,
    metadata: string
  ): Promise<TransactionOutcome> {
    if (this.db.dialect === 'sqlite') {
      return this.createSqliteArtifact(input, artifactId, contentHash, metadata);
    }

    return this.createPostgresArtifact(input, artifactId, contentHash, metadata);
  }

  private createSqliteArtifact(
    input: UpsertArtifactInput,
    artifactId: string,
    contentHash: string,
    metadata: string
  ): TransactionOutcome {
    const handle = this.db as SqliteDatabaseHandle;
    const transaction = handle.sqlite.transaction(() => {
      const now = this.now();
      const botId = input.bot?.id ?? null;

      handle.sqlite
        .prepare(
          `
            INSERT INTO artifacts (
              id, account_id, slug, type, title, content, content_hash, metadata,
              version_num, created_by_bot, deleted_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
          `
        )
        .run(
          artifactId,
          input.account.id,
          input.slug,
          input.type,
          input.title,
          input.content,
          contentHash,
          metadata,
          botId,
          now,
          now
        );

      this.insertSqliteVersion({
        artifactId,
        versionNum: 1,
        type: input.type,
        title: input.title,
        content: input.content,
        contentHash,
        changeSummary: input.changeSummary ?? null,
        restoredFromVersion: null,
        botId,
        now,
      });

      const shareEvent = this.ensureSqliteShare(handle, input, artifactId, now);
      const artifact = this.mustGetSqliteArtifactById(handle, artifactId);
      const share = this.getSqliteActiveShare(handle, artifactId);
      const events = [
        artifactEvent('artifact.created', input.account.id, artifactId, botId, now),
        ...shareCreatedEvents(input.account.id, artifactId, shareEvent, now),
      ];

      return {
        mode: 'created' as const,
        artifact: artifactFromRow(artifact),
        share: share ? shareFromRow(share, this.baseUrl) : null,
        events,
      };
    });

    return transaction.immediate();
  }

  private async createPostgresArtifact(
    input: UpsertArtifactInput,
    artifactId: string,
    contentHash: string,
    metadata: string
  ): Promise<TransactionOutcome> {
    const handle = this.db as PostgresDatabaseHandle;
    const client = await handle.pool.connect();

    try {
      await client.query('BEGIN');
      const now = this.now();
      const botId = input.bot?.id ?? null;

      await client.query(
        `
          INSERT INTO artifacts (
            id, account_id, slug, type, title, content, content_hash, metadata,
            version_num, created_by_bot, deleted_at, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, NULL, $10, $10)
        `,
        [
          artifactId,
          input.account.id,
          input.slug,
          input.type,
          input.title,
          input.content,
          contentHash,
          metadata,
          botId,
          now,
        ]
      );

      await insertPostgresVersion(client, {
        artifactId,
        versionNum: 1,
        type: input.type,
        title: input.title,
        content: input.content,
        contentHash,
        changeSummary: input.changeSummary ?? null,
        restoredFromVersion: null,
        botId,
        now,
      });

      const shareEvent = await this.ensurePostgresShare(client, input, artifactId, now);
      const artifact = await this.mustGetPostgresArtifactById(client, artifactId);
      const share = await this.getPostgresActiveShare(client, artifactId);
      await client.query('COMMIT');

      return {
        mode: 'created',
        artifact: artifactFromRow(artifact),
        share: share ? shareFromRow(share, this.baseUrl) : null,
        events: [
          artifactEvent('artifact.created', input.account.id, artifactId, botId, now),
          ...shareCreatedEvents(input.account.id, artifactId, shareEvent, now),
        ],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateArtifact(
    input: UpsertArtifactInput,
    contentHash: string,
    versionQuotaChecked: boolean,
    metadata: string
  ): Promise<TransactionOutcome> {
    if (this.db.dialect === 'sqlite') {
      return this.updateSqliteArtifact(input, contentHash, versionQuotaChecked, metadata);
    }

    return this.updatePostgresArtifact(input, contentHash, versionQuotaChecked, metadata);
  }

  private updateSqliteArtifact(
    input: UpsertArtifactInput,
    contentHash: string,
    versionQuotaChecked: boolean,
    metadata: string
  ): TransactionOutcome {
    const handle = this.db as SqliteDatabaseHandle;
    const transaction = handle.sqlite.transaction(() => {
      const current = this.getSqliteLiveArtifactBySlug(handle, input.account.id, input.slug);
      if (!current) {
        throw new ServiceError(404, 'not_found', 'Artifact not found');
      }

      const now = this.now();
      const botId = input.bot?.id ?? null;
      const shareEvent = this.ensureSqliteShare(handle, input, current.id, now);

      if (current.content_hash === contentHash) {
        this.updateSqliteMetadataIfNeeded(handle, current, metadata, now);
        const artifact = this.mustGetSqliteArtifactById(handle, current.id);
        const share = this.getSqliteActiveShare(handle, current.id);
        return {
          mode: 'unchanged' as const,
          artifact: artifactFromRow(artifact),
          share: share ? shareFromRow(share, this.baseUrl) : null,
          events: shareCreatedEvents(input.account.id, current.id, shareEvent, now),
        };
      }

      if (!versionQuotaChecked) {
        throw new VersionQuotaRequired(current.id);
      }

      const nextVersion = current.version_num + 1;
      handle.sqlite
        .prepare(
          `
            UPDATE artifacts
            SET type = ?, title = ?, content = ?, content_hash = ?, metadata = ?,
                version_num = ?, updated_at = ?
            WHERE id = ? AND account_id = ? AND deleted_at IS NULL
          `
        )
        .run(
          input.type,
          input.title,
          input.content,
          contentHash,
          metadata,
          nextVersion,
          now,
          current.id,
          input.account.id
        );

      this.insertSqliteVersion({
        artifactId: current.id,
        versionNum: nextVersion,
        type: input.type,
        title: input.title,
        content: input.content,
        contentHash,
        changeSummary: input.changeSummary ?? null,
        restoredFromVersion: null,
        botId,
        now,
      });

      const artifact = this.mustGetSqliteArtifactById(handle, current.id);
      const share = this.getSqliteActiveShare(handle, current.id);
      return {
        mode: 'updated' as const,
        artifact: artifactFromRow(artifact),
        share: share ? shareFromRow(share, this.baseUrl) : null,
        events: [
          artifactEvent('artifact.updated', input.account.id, current.id, botId, now),
          ...shareCreatedEvents(input.account.id, current.id, shareEvent, now),
        ],
      };
    });

    return transaction.immediate();
  }

  private async updatePostgresArtifact(
    input: UpsertArtifactInput,
    contentHash: string,
    versionQuotaChecked: boolean,
    metadata: string
  ): Promise<TransactionOutcome> {
    const handle = this.db as PostgresDatabaseHandle;
    const client = await handle.pool.connect();

    try {
      await client.query('BEGIN');
      const current = await getPostgresLiveArtifactBySlug(
        client,
        input.account.id,
        input.slug,
        true
      );
      if (!current) {
        throw new ServiceError(404, 'not_found', 'Artifact not found');
      }

      const now = this.now();
      const botId = input.bot?.id ?? null;
      const shareEvent = await this.ensurePostgresShare(client, input, current.id, now);

      if (current.content_hash === contentHash) {
        await this.updatePostgresMetadataIfNeeded(client, current, metadata, now);
        const artifact = await this.mustGetPostgresArtifactById(client, current.id);
        const share = await this.getPostgresActiveShare(client, current.id);
        await client.query('COMMIT');
        return {
          mode: 'unchanged',
          artifact: artifactFromRow(artifact),
          share: share ? shareFromRow(share, this.baseUrl) : null,
          events: shareCreatedEvents(input.account.id, current.id, shareEvent, now),
        };
      }

      if (!versionQuotaChecked) {
        throw new VersionQuotaRequired(current.id);
      }

      const nextVersion = current.version_num + 1;
      await client.query(
        `
          UPDATE artifacts
          SET type = $1, title = $2, content = $3, content_hash = $4, metadata = $5,
              version_num = $6, updated_at = $7
          WHERE id = $8 AND account_id = $9 AND deleted_at IS NULL
        `,
        [
          input.type,
          input.title,
          input.content,
          contentHash,
          metadata,
          nextVersion,
          now,
          current.id,
          input.account.id,
        ]
      );

      await insertPostgresVersion(client, {
        artifactId: current.id,
        versionNum: nextVersion,
        type: input.type,
        title: input.title,
        content: input.content,
        contentHash,
        changeSummary: input.changeSummary ?? null,
        restoredFromVersion: null,
        botId,
        now,
      });

      const artifact = await this.mustGetPostgresArtifactById(client, current.id);
      const share = await this.getPostgresActiveShare(client, current.id);
      await client.query('COMMIT');

      return {
        mode: 'updated',
        artifact: artifactFromRow(artifact),
        share: share ? shareFromRow(share, this.baseUrl) : null,
        events: [
          artifactEvent('artifact.updated', input.account.id, current.id, botId, now),
          ...shareCreatedEvents(input.account.id, current.id, shareEvent, now),
        ],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private restoreSqlite(
    input: RestoreArtifactInput,
    source: ArtifactVersionSnapshot
  ): TransactionOutcome {
    const handle = this.db as SqliteDatabaseHandle;
    const transaction = handle.sqlite.transaction(() => {
      const current = this.getSqliteLiveArtifactById(handle, input.account.id, input.artifactId);
      if (!current) {
        throw new ServiceError(404, 'not_found', 'Artifact not found');
      }

      const sourceRow = this.getSqliteVersion(handle, input.artifactId, input.versionNum);
      if (!sourceRow) {
        throw new ServiceError(404, 'not_found', 'Artifact version not found');
      }

      if (current.version_num === input.versionNum) {
        throw new ServiceError(400, 'validation_failed', 'Cannot restore the current version', {
          reason: 'already_current',
        });
      }

      const now = this.now();
      const nextVersion = current.version_num + 1;
      const botId = input.bot?.id ?? null;

      handle.sqlite
        .prepare(
          `
            UPDATE artifacts
            SET type = ?, title = ?, content = ?, content_hash = ?, version_num = ?, updated_at = ?
            WHERE id = ? AND account_id = ? AND deleted_at IS NULL
          `
        )
        .run(
          sourceRow.type,
          sourceRow.title,
          sourceRow.content,
          sourceRow.content_hash,
          nextVersion,
          now,
          input.artifactId,
          input.account.id
        );

      this.insertSqliteVersion({
        artifactId: input.artifactId,
        versionNum: nextVersion,
        type: source.type,
        title: source.title,
        content: source.content,
        contentHash: source.contentHash,
        changeSummary: input.changeSummary ?? null,
        restoredFromVersion: input.versionNum,
        botId,
        now,
      });

      const artifact = this.mustGetSqliteArtifactById(handle, input.artifactId);
      const share = this.getSqliteActiveShare(handle, input.artifactId);
      return {
        mode: 'updated' as const,
        artifact: artifactFromRow(artifact),
        share: share ? shareFromRow(share, this.baseUrl) : null,
        events: [artifactEvent('artifact.updated', input.account.id, input.artifactId, botId, now)],
      };
    });

    return transaction.immediate();
  }

  private async restorePostgres(
    input: RestoreArtifactInput,
    source: ArtifactVersionSnapshot
  ): Promise<TransactionOutcome> {
    const handle = this.db as PostgresDatabaseHandle;
    const client = await handle.pool.connect();

    try {
      await client.query('BEGIN');
      const current = await getPostgresLiveArtifactById(
        client,
        input.account.id,
        input.artifactId,
        true
      );
      const sourceRow = await getPostgresVersion(client, input.artifactId, input.versionNum);

      if (!current) {
        throw new ServiceError(404, 'not_found', 'Artifact not found');
      }
      if (!sourceRow) {
        throw new ServiceError(404, 'not_found', 'Artifact version not found');
      }
      if (current.version_num === input.versionNum) {
        throw new ServiceError(400, 'validation_failed', 'Cannot restore the current version', {
          reason: 'already_current',
        });
      }

      const now = this.now();
      const nextVersion = current.version_num + 1;
      const botId = input.bot?.id ?? null;

      await client.query(
        `
          UPDATE artifacts
          SET type = $1, title = $2, content = $3, content_hash = $4,
              version_num = $5, updated_at = $6
          WHERE id = $7 AND account_id = $8 AND deleted_at IS NULL
        `,
        [
          sourceRow.type,
          sourceRow.title,
          sourceRow.content,
          sourceRow.content_hash,
          nextVersion,
          now,
          input.artifactId,
          input.account.id,
        ]
      );

      await insertPostgresVersion(client, {
        artifactId: input.artifactId,
        versionNum: nextVersion,
        type: source.type,
        title: source.title,
        content: source.content,
        contentHash: source.contentHash,
        changeSummary: input.changeSummary ?? null,
        restoredFromVersion: input.versionNum,
        botId,
        now,
      });

      const artifact = await this.mustGetPostgresArtifactById(client, input.artifactId);
      const share = await this.getPostgresActiveShare(client, input.artifactId);
      await client.query('COMMIT');

      return {
        mode: 'updated',
        artifact: artifactFromRow(artifact),
        share: share ? shareFromRow(share, this.baseUrl) : null,
        events: [artifactEvent('artifact.updated', input.account.id, input.artifactId, botId, now)],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private softDeleteSqlite(input: SoftDeleteArtifactInput): {
    deleted: boolean;
    revokedShareCount: number;
    events: ArtifactEvent[];
  } {
    const handle = this.db as SqliteDatabaseHandle;
    const transaction = handle.sqlite.transaction(() => {
      const artifact = this.getSqliteLiveArtifactById(handle, input.account.id, input.artifactId);
      if (!artifact) {
        return { deleted: false, revokedShareCount: 0, events: [] };
      }

      const now = this.now();
      const activeShares = handle.sqlite
        .prepare('SELECT * FROM shares WHERE artifact_id = ? AND revoked_at IS NULL')
        .all(input.artifactId) as ShareDbRow[];

      const revoked = handle.sqlite
        .prepare('UPDATE shares SET revoked_at = ? WHERE artifact_id = ? AND revoked_at IS NULL')
        .run(now, input.artifactId);

      handle.sqlite
        .prepare(
          `
            UPDATE artifacts
            SET deleted_at = ?, updated_at = ?
            WHERE id = ? AND account_id = ? AND deleted_at IS NULL
          `
        )
        .run(now, now, input.artifactId, input.account.id);

      return {
        deleted: true,
        revokedShareCount: Number(revoked.changes),
        events: [
          artifactEvent('artifact.deleted', input.account.id, input.artifactId, null, now),
          ...activeShares.map((share) =>
            shareRevokedEvent(input.account.id, input.artifactId, share.id, now)
          ),
        ],
      };
    });

    return transaction.immediate();
  }

  private async softDeletePostgres(input: SoftDeleteArtifactInput): Promise<{
    deleted: boolean;
    revokedShareCount: number;
    events: ArtifactEvent[];
  }> {
    const handle = this.db as PostgresDatabaseHandle;
    const client = await handle.pool.connect();

    try {
      await client.query('BEGIN');
      const artifact = await getPostgresLiveArtifactById(
        client,
        input.account.id,
        input.artifactId,
        true
      );
      if (!artifact) {
        await client.query('COMMIT');
        return { deleted: false, revokedShareCount: 0, events: [] };
      }

      const now = this.now();
      const activeShares = await client.query<ShareDbRow>(
        'SELECT * FROM shares WHERE artifact_id = $1 AND revoked_at IS NULL',
        [input.artifactId]
      );
      const revoked = await client.query(
        'UPDATE shares SET revoked_at = $1 WHERE artifact_id = $2 AND revoked_at IS NULL',
        [now, input.artifactId]
      );

      await client.query(
        `
          UPDATE artifacts
          SET deleted_at = $1, updated_at = $1
          WHERE id = $2 AND account_id = $3 AND deleted_at IS NULL
        `,
        [now, input.artifactId, input.account.id]
      );
      await client.query('COMMIT');

      return {
        deleted: true,
        revokedShareCount: revoked.rowCount ?? 0,
        events: [
          artifactEvent('artifact.deleted', input.account.id, input.artifactId, null, now),
          ...activeShares.rows.map((share) =>
            shareRevokedEvent(input.account.id, input.artifactId, share.id, now)
          ),
        ],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async findLiveArtifactBySlug(
    accountId: string,
    slug: string
  ): Promise<ArtifactDbRow | null> {
    if (this.db.dialect === 'sqlite') {
      return this.getSqliteLiveArtifactBySlug(this.db, accountId, slug);
    }

    return getPostgresLiveArtifactBySlug(this.db.pool, accountId, slug, false);
  }

  private async findLiveArtifactById(
    accountId: string,
    artifactId: string
  ): Promise<ArtifactDbRow | null> {
    if (this.db.dialect === 'sqlite') {
      return this.getSqliteLiveArtifactById(this.db, accountId, artifactId);
    }

    return getPostgresLiveArtifactById(this.db.pool, accountId, artifactId, false);
  }

  private async findVersion(
    artifactId: string,
    versionNum: number
  ): Promise<ArtifactVersionSnapshot | null> {
    if (this.db.dialect === 'sqlite') {
      const row = this.getSqliteVersion(this.db, artifactId, versionNum);
      return row ? versionFromRow(row) : null;
    }

    const row = await getPostgresVersion(this.db.pool, artifactId, versionNum);
    return row ? versionFromRow(row) : null;
  }

  private async findActiveShare(artifactId: string): Promise<ShareDbRow | null> {
    if (this.db.dialect === 'sqlite') {
      return this.getSqliteActiveShare(this.db, artifactId);
    }

    return getPostgresActiveShare(this.db.pool, artifactId);
  }

  private getSqliteLiveArtifactBySlug(
    handle: SqliteDatabaseHandle,
    accountId: string,
    slug: string
  ): ArtifactDbRow | null {
    return (
      (handle.sqlite
        .prepare(
          `
            SELECT *
            FROM artifacts
            WHERE account_id = ? AND slug = ? AND deleted_at IS NULL
          `
        )
        .get(accountId, slug) as ArtifactDbRow | undefined) ?? null
    );
  }

  private getSqliteLiveArtifactById(
    handle: SqliteDatabaseHandle,
    accountId: string,
    artifactId: string
  ): ArtifactDbRow | null {
    return (
      (handle.sqlite
        .prepare(
          `
            SELECT *
            FROM artifacts
            WHERE account_id = ? AND id = ? AND deleted_at IS NULL
          `
        )
        .get(accountId, artifactId) as ArtifactDbRow | undefined) ?? null
    );
  }

  private mustGetSqliteArtifactById(
    handle: SqliteDatabaseHandle,
    artifactId: string
  ): ArtifactDbRow {
    const artifact = handle.sqlite
      .prepare('SELECT * FROM artifacts WHERE id = ?')
      .get(artifactId) as ArtifactDbRow | undefined;

    if (!artifact) {
      throw new ServiceError(404, 'not_found', 'Artifact not found');
    }

    return artifact;
  }

  private getSqliteVersion(
    handle: SqliteDatabaseHandle,
    artifactId: string,
    versionNum: number
  ): ArtifactVersionDbRow | null {
    return (
      (handle.sqlite
        .prepare('SELECT * FROM artifact_versions WHERE artifact_id = ? AND version_num = ?')
        .get(artifactId, versionNum) as ArtifactVersionDbRow | undefined) ?? null
    );
  }

  private getSqliteActiveShare(
    handle: SqliteDatabaseHandle,
    artifactId: string
  ): ShareDbRow | null {
    return (
      (handle.sqlite
        .prepare('SELECT * FROM shares WHERE artifact_id = ? AND revoked_at IS NULL')
        .get(artifactId) as ShareDbRow | undefined) ?? null
    );
  }

  private insertSqliteVersion(input: {
    artifactId: string;
    versionNum: number;
    type: ArtifactType;
    title: string;
    content: string;
    contentHash: string;
    changeSummary: string | null;
    restoredFromVersion: number | null;
    botId: string | null;
    now: number;
  }): void {
    const handle = this.db as SqliteDatabaseHandle;
    handle.sqlite
      .prepare(
        `
          INSERT INTO artifact_versions (
            artifact_id, version_num, type, title, content, content_hash,
            change_summary, restored_from_version, created_by_bot, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.artifactId,
        input.versionNum,
        input.type,
        input.title,
        input.content,
        input.contentHash,
        input.changeSummary,
        input.restoredFromVersion,
        input.botId,
        input.now
      );
  }

  private ensureSqliteShare(
    handle: SqliteDatabaseHandle,
    input: UpsertArtifactInput,
    artifactId: string,
    now: number
  ): PendingShareEvent | null {
    if (!input.share && input.passwordHash === undefined) {
      return null;
    }

    const existing = this.getSqliteActiveShare(handle, artifactId);
    if (existing) {
      if (input.passwordHash !== undefined) {
        handle.sqlite
          .prepare(
            `
              UPDATE shares
              SET password_hash = ?, password_updated_at = ?
              WHERE id = ?
            `
          )
          .run(input.passwordHash, now, existing.id);
      }
      return null;
    }

    const shareId = nanoid(22);
    handle.sqlite
      .prepare(
        `
          INSERT INTO shares (
            id, artifact_id, password_hash, password_updated_at, expires_at,
            revoked_at, view_count, unique_viewer_count, last_viewed_at, created_at
          )
          VALUES (?, ?, ?, ?, NULL, NULL, 0, 0, NULL, ?)
        `
      )
      .run(
        shareId,
        artifactId,
        input.passwordHash ?? null,
        input.passwordHash === undefined ? null : now,
        now
      );

    return { accountId: input.account.id, artifactId, shareId };
  }

  private async ensurePostgresShare(
    client: PoolClient,
    input: UpsertArtifactInput,
    artifactId: string,
    now: number
  ): Promise<PendingShareEvent | null> {
    if (!input.share && input.passwordHash === undefined) {
      return null;
    }

    const existing = await getPostgresActiveShare(client, artifactId);
    if (existing) {
      if (input.passwordHash !== undefined) {
        await client.query(
          `
            UPDATE shares
            SET password_hash = $1, password_updated_at = $2
            WHERE id = $3
          `,
          [input.passwordHash, now, existing.id]
        );
      }
      return null;
    }

    const shareId = nanoid(22);
    await client.query(
      `
        INSERT INTO shares (
          id, artifact_id, password_hash, password_updated_at, expires_at,
          revoked_at, view_count, unique_viewer_count, last_viewed_at, created_at
        )
        VALUES ($1, $2, $3, $4, NULL, NULL, 0, 0, NULL, $5)
      `,
      [
        shareId,
        artifactId,
        input.passwordHash ?? null,
        input.passwordHash === undefined ? null : now,
        now,
      ]
    );

    return { accountId: input.account.id, artifactId, shareId };
  }

  private updateSqliteMetadataIfNeeded(
    handle: SqliteDatabaseHandle,
    current: ArtifactDbRow,
    metadata: string,
    now: number
  ): void {
    if (metadata === '{}' || metadata === current.metadata) {
      return;
    }

    handle.sqlite
      .prepare('UPDATE artifacts SET metadata = ?, updated_at = ? WHERE id = ?')
      .run(metadata, now, current.id);
  }

  private async updatePostgresMetadataIfNeeded(
    client: PoolClient,
    current: ArtifactDbRow,
    metadata: string,
    now: number
  ): Promise<void> {
    if (metadata === '{}' || metadata === current.metadata) {
      return;
    }

    await client.query('UPDATE artifacts SET metadata = $1, updated_at = $2 WHERE id = $3', [
      metadata,
      now,
      current.id,
    ]);
  }

  private async mustGetPostgresArtifactById(
    client: PoolClient,
    artifactId: string
  ): Promise<ArtifactDbRow> {
    const result = await client.query<ArtifactDbRow>('SELECT * FROM artifacts WHERE id = $1', [
      artifactId,
    ]);
    const artifact = result.rows[0];
    if (!artifact) {
      throw new ServiceError(404, 'not_found', 'Artifact not found');
    }
    return artifact;
  }

  private async getPostgresActiveShare(
    client: PoolClient,
    artifactId: string
  ): Promise<ShareDbRow | null> {
    return getPostgresActiveShare(client, artifactId);
  }

  private async enforceUseTemplate(input: UpsertArtifactInput): Promise<void> {
    if (!input.templateSlug) {
      return;
    }

    await this.enforceQuota(input.account, { type: 'use_template' });
  }

  private async enforceSetSharePassword(input: UpsertArtifactInput): Promise<void> {
    if (input.passwordHash === undefined) {
      return;
    }

    await this.enforceQuota(input.account, { type: 'set_share_password' });
  }

  private async enforceQuota(
    account: Account,
    action: Parameters<CloudModule['checkQuota']>[1]
  ): Promise<void> {
    const decision = await this.extension.checkQuota(account, action);
    if (!decision.allow) {
      throw new ServiceError(403, 'quota_exceeded', decision.message, { code: decision.code });
    }
  }

  private emitOutcome(outcome: TransactionOutcome): ArtifactWriteResult {
    for (const event of outcome.events) {
      this.emitEvent(event);
    }

    return {
      mode: outcome.mode,
      artifact: outcome.artifact,
      share: outcome.share,
    };
  }

  private emitEvent(event: ArtifactEvent): void {
    try {
      this.extension.onArtifactEvent?.(event);
    } catch (error) {
      this.logger?.warn({ err: error, event_type: event.type }, 'extension.artifact_event_failed');
    }
  }
}

async function getPostgresLiveArtifactBySlug(
  executor: Pool | PoolClient,
  accountId: string,
  slug: string,
  lock: boolean
): Promise<ArtifactDbRow | null> {
  const query = `
    SELECT *
    FROM artifacts
    WHERE account_id = $1 AND slug = $2 AND deleted_at IS NULL
    ${lock ? 'FOR UPDATE' : ''}
  `;
  const result = await executor.query<ArtifactDbRow>(query, [accountId, slug]);
  return result.rows[0] ?? null;
}

async function getPostgresLiveArtifactById(
  executor: Pool | PoolClient,
  accountId: string,
  artifactId: string,
  lock: boolean
): Promise<ArtifactDbRow | null> {
  const query = `
    SELECT *
    FROM artifacts
    WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL
    ${lock ? 'FOR UPDATE' : ''}
  `;
  const result = await executor.query<ArtifactDbRow>(query, [accountId, artifactId]);
  return result.rows[0] ?? null;
}

async function getPostgresVersion(
  executor: Pool | PoolClient,
  artifactId: string,
  versionNum: number
): Promise<ArtifactVersionDbRow | null> {
  const result = await executor.query<ArtifactVersionDbRow>(
    'SELECT * FROM artifact_versions WHERE artifact_id = $1 AND version_num = $2',
    [artifactId, versionNum]
  );
  return result.rows[0] ?? null;
}

async function getPostgresActiveShare(
  executor: Pool | PoolClient,
  artifactId: string
): Promise<ShareDbRow | null> {
  const result = await executor.query<ShareDbRow>(
    'SELECT * FROM shares WHERE artifact_id = $1 AND revoked_at IS NULL',
    [artifactId]
  );
  return result.rows[0] ?? null;
}

async function insertPostgresVersion(
  client: PoolClient,
  input: {
    artifactId: string;
    versionNum: number;
    type: ArtifactType;
    title: string;
    content: string;
    contentHash: string;
    changeSummary: string | null;
    restoredFromVersion: number | null;
    botId: string | null;
    now: number;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO artifact_versions (
        artifact_id, version_num, type, title, content, content_hash,
        change_summary, restored_from_version, created_by_bot, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      input.artifactId,
      input.versionNum,
      input.type,
      input.title,
      input.content,
      input.contentHash,
      input.changeSummary,
      input.restoredFromVersion,
      input.botId,
      input.now,
    ]
  );
}

function artifactFromRow(row: ArtifactDbRow): ArtifactSnapshot {
  return {
    id: row.id,
    accountId: row.account_id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    metadata: parseMetadata(row.metadata),
    versionNum: row.version_num,
    createdByBot: row.created_by_bot,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function versionFromRow(row: ArtifactVersionDbRow): ArtifactVersionSnapshot {
  return {
    artifactId: row.artifact_id,
    versionNum: row.version_num,
    type: row.type,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    changeSummary: row.change_summary,
    restoredFromVersion: row.restored_from_version,
    createdByBot: row.created_by_bot,
    createdAt: row.created_at,
  };
}

function shareFromRow(row: ShareDbRow, baseUrl: string): ShareSnapshot {
  return {
    shareId: row.id,
    url: `${baseUrl}/a/${row.id}`,
    passwordProtected: row.password_hash !== null,
    passwordUpdatedAt: row.password_updated_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    viewCount: row.view_count,
    uniqueViewerCount: row.unique_viewer_count,
    lastViewedAt: row.last_viewed_at,
    createdAt: row.created_at,
  };
}

function serializeMetadata(metadata: Record<string, unknown> | undefined): string {
  return JSON.stringify(metadata ?? {});
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? String(error.code) : '';
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505';
}

function artifactEvent(
  type: 'artifact.created' | 'artifact.updated' | 'artifact.deleted',
  accountId: string,
  artifactId: string,
  botId: string | null,
  now: number
): ArtifactEvent {
  return {
    type,
    accountId,
    artifactId,
    botId,
    at: new Date(now).toISOString(),
  };
}

function shareCreatedEvents(
  accountId: string,
  artifactId: string,
  share: PendingShareEvent | null,
  now: number
): ArtifactEvent[] {
  if (!share) {
    return [];
  }

  return [
    {
      type: 'share.created',
      accountId,
      artifactId,
      shareId: share.shareId,
      at: new Date(now).toISOString(),
    },
  ];
}

function shareRevokedEvent(
  accountId: string,
  artifactId: string,
  shareId: string,
  now: number
): ArtifactEvent {
  return {
    type: 'share.revoked',
    accountId,
    artifactId,
    shareId,
    at: new Date(now).toISOString(),
  };
}
