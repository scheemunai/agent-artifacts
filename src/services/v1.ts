import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle, PostgresDatabaseHandle } from '../db/client.js';
import type { Account, CloudModule } from '../extension/cloud-module.js';
import {
  decodeSortCursor,
  decodeVersionCursor,
  encodeSortCursor,
  encodeVersionCursor,
} from '../lib/cursor.js';
import { AppError } from '../lib/errors.js';
import {
  ARTIFACT_ID_PATTERN,
  type ArtifactType,
  BOT_KEY_PATTERN,
} from '../lib/schemas/artifacts.js';
import { ArtifactService, type ArtifactSnapshot } from './artifacts.js';
import { hashPassword } from './auth.js';
import { hashSecret } from './bots.js';
import {
  getTemplateResponse as getTemplateResponseFromService,
  listTemplatesResponse as listTemplatesResponseFromService,
  mergeTemplate as mergeTemplateFromService,
} from './templates.js';

export interface AuthPrincipal {
  account: Account;
  bot: BotRef;
  apiKeyHash: string;
}

export interface BotRef {
  id: string;
  name: string;
  byline: string | null;
}

export interface ArtifactRow {
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

export interface VersionRow {
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

export interface ShareRow {
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

export interface TemplateRow {
  id: string;
  account_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  type: ArtifactType;
  content: string;
  slots: string;
  created_from_artifact: string | null;
  created_at: number;
  updated_at: number;
}

export interface ListArtifactsOptions {
  bot?: string;
  type?: ArtifactType;
  updatedSince?: number;
  q?: string;
  limit: number;
  cursor?: string;
}

export interface ListVersionsOptions {
  limit: number;
  cursor?: string;
}

export interface ListTemplatesOptions {
  limit: number;
  cursor?: string;
}

export interface UpdateArtifactRequest {
  title?: string;
  content?: string;
  type?: ArtifactType;
  slug?: string;
  metadata?: Record<string, unknown>;
  changeSummary?: string;
}

export interface TemplateMergeResult {
  template: TemplateRow;
  content: string;
  type: ArtifactType;
}

const botLastUsedUpdates = new Map<string, number>();
const dayMs = 86_400_000;

export function bearerToken(authorization: string | undefined): string {
  if (!authorization) {
    throw unauthorized('Missing bearer token');
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) {
    throw unauthorized('Missing bearer token');
  }

  const token = match[1];
  if (!BOT_KEY_PATTERN.test(token)) {
    throw unauthorized('Invalid or revoked bearer token');
  }

  return token;
}

export async function authenticateBot(
  db: DatabaseHandle,
  authorization: string | undefined
): Promise<AuthPrincipal> {
  const token = bearerToken(authorization);
  return authenticateBotToken(db, token);
}

export async function authenticateBotToken(
  db: DatabaseHandle,
  token: string
): Promise<AuthPrincipal> {
  const apiKeyHash = hashSecret(token);
  const row = await findBotByHash(db, apiKeyHash);

  if (!row || row.revoked_at !== null) {
    throw unauthorized('Invalid or revoked bearer token');
  }

  if (row.suspended_at !== null) {
    throw new AppError(403, 'account_suspended', 'Account suspended');
  }

  throttledLastUsedUpdate(db, row.id, apiKeyHash);

  return {
    apiKeyHash,
    account: {
      id: row.account_id,
      email: row.email,
      suspendedAt: row.suspended_at,
    },
    bot: {
      id: row.id,
      name: row.name,
      byline: row.byline,
    },
  };
}

export async function createPasswordHash(password: string): Promise<string> {
  return hashPassword(password);
}

export async function publishArtifact(input: {
  db: DatabaseHandle;
  cloudModule: CloudModule;
  config: AppConfig;
  auth: AuthPrincipal;
  slug: string;
  type: ArtifactType;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  changeSummary?: string;
  share?: boolean;
  passwordHash?: string | null;
  templateSlug?: string;
}): Promise<{ status: 200 | 201; body: Record<string, unknown> }> {
  const service = new ArtifactService({
    db: input.db,
    extension: input.cloudModule,
    baseUrl: input.config.baseUrl,
  });
  const result = await service.upsertArtifact({
    account: input.auth.account,
    bot: input.auth.bot,
    slug: input.slug,
    type: input.type,
    title: input.title,
    content: input.content,
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    ...(input.changeSummary !== undefined ? { changeSummary: input.changeSummary } : {}),
    ...(input.share !== undefined ? { share: input.share } : {}),
    ...(input.passwordHash !== undefined ? { passwordHash: input.passwordHash } : {}),
    ...(input.templateSlug !== undefined ? { templateSlug: input.templateSlug } : {}),
  });

  return {
    status: result.mode === 'created' ? 201 : 200,
    body: await formatArtifact(
      input.db,
      input.cloudModule,
      input.auth.account,
      input.config,
      result.artifact,
      {
        unchanged: result.mode === 'unchanged',
        includeContent: true,
      }
    ),
  };
}

export async function updateArtifact(input: {
  db: DatabaseHandle;
  cloudModule: CloudModule;
  config: AppConfig;
  auth: AuthPrincipal;
  idOrSlug: string;
  patch: UpdateArtifactRequest;
}): Promise<Record<string, unknown>> {
  const service = new ArtifactService({
    db: input.db,
    extension: input.cloudModule,
    baseUrl: input.config.baseUrl,
  });
  const result = await service.patchArtifact({
    account: input.auth.account,
    bot: input.auth.bot,
    idOrSlug: input.idOrSlug,
    patch: {
      ...(input.patch.slug !== undefined ? { slug: input.patch.slug } : {}),
      ...(input.patch.type !== undefined ? { type: input.patch.type } : {}),
      ...(input.patch.title !== undefined ? { title: input.patch.title } : {}),
      ...(input.patch.content !== undefined ? { content: input.patch.content } : {}),
      ...(input.patch.metadata !== undefined ? { metadata: input.patch.metadata } : {}),
      ...(input.patch.changeSummary !== undefined
        ? { changeSummary: input.patch.changeSummary }
        : {}),
    },
  });

  return formatArtifact(
    input.db,
    input.cloudModule,
    input.auth.account,
    input.config,
    result.artifact,
    {
      unchanged: result.mode === 'unchanged',
      includeContent: true,
    }
  );
}

export async function deleteArtifact(input: {
  db: DatabaseHandle;
  cloudModule: CloudModule;
  config: AppConfig;
  auth: AuthPrincipal;
  idOrSlug: string;
}): Promise<Record<string, unknown>> {
  const artifact = await resolveArtifactIncludingDeleted(
    input.db,
    input.auth.account.id,
    input.idOrSlug
  );
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }

  if (artifact.deleted_at !== null) {
    return { id: artifact.id, deleted: true, already_deleted: true };
  }

  const service = new ArtifactService({
    db: input.db,
    extension: input.cloudModule,
    baseUrl: input.config.baseUrl,
  });
  await service.softDeleteArtifact({ account: input.auth.account, artifactId: artifact.id });

  return {
    id: artifact.id,
    deleted: true,
    purge_after: toIso(Date.now() + input.config.artifactPurgeDays * dayMs),
  };
}

export async function restoreArtifactVersion(input: {
  db: DatabaseHandle;
  cloudModule: CloudModule;
  config: AppConfig;
  auth: AuthPrincipal;
  idOrSlug: string;
  versionNum: number;
  changeSummary?: string;
}): Promise<Record<string, unknown>> {
  const artifact = await resolveLiveArtifact(input.db, input.auth.account.id, input.idOrSlug);
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }

  const service = new ArtifactService({
    db: input.db,
    extension: input.cloudModule,
    baseUrl: input.config.baseUrl,
  });
  const result = await service.restoreVersion({
    account: input.auth.account,
    bot: input.auth.bot,
    artifactId: artifact.id,
    versionNum: input.versionNum,
    changeSummary: input.changeSummary ?? `Restored from version ${input.versionNum}`,
  });
  const restoredVersion = await findVersion(input.db, artifact.id, result.artifact.versionNum);
  if (!restoredVersion) {
    throw new AppError(500, 'internal_error', 'Restored version was not persisted');
  }

  return {
    ...(await formatVersion(input.db, restoredVersion, true)),
    artifact: {
      id: result.artifact.id,
      version_num: result.artifact.versionNum,
      updated_at: toIso(result.artifact.updatedAt),
    },
  };
}

export async function getArtifactResponse(input: {
  db: DatabaseHandle;
  cloudModule: CloudModule;
  config: AppConfig;
  account: Account;
  idOrSlug: string;
}): Promise<Record<string, unknown>> {
  const artifact = await resolveLiveArtifact(input.db, input.account.id, input.idOrSlug);
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }

  return formatArtifact(
    input.db,
    input.cloudModule,
    input.account,
    input.config,
    artifactSnapshotFromRow(artifact),
    {
      includeContent: true,
    }
  );
}

export async function listArtifactsResponse(input: {
  db: DatabaseHandle;
  cloudModule: CloudModule;
  config: AppConfig;
  account: Account;
  options: ListArtifactsOptions;
}): Promise<Record<string, unknown>> {
  const cursor = decodeSortCursor(input.options.cursor);
  const rows = await listArtifactsRows(
    input.db,
    input.account.id,
    input.options,
    cursor,
    input.options.limit + 1
  );
  const pageRows = rows.slice(0, input.options.limit);
  const items = [];

  for (const row of pageRows) {
    items.push(
      await formatArtifact(
        input.db,
        input.cloudModule,
        input.account,
        input.config,
        artifactSnapshotFromRow(row),
        {
          includeContent: false,
          list: true,
        }
      )
    );
  }

  return {
    items,
    next_cursor:
      rows.length > input.options.limit
        ? encodeSortCursor({
            u: pageRows.at(-1)?.updated_at ?? 0,
            id: pageRows.at(-1)?.id ?? '',
          })
        : null,
  };
}

export async function listVersionsResponse(input: {
  db: DatabaseHandle;
  accountId: string;
  idOrSlug: string;
  options: ListVersionsOptions;
}): Promise<Record<string, unknown>> {
  const artifact = await resolveLiveArtifact(input.db, input.accountId, input.idOrSlug);
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }

  const cursor = decodeVersionCursor(input.options.cursor);
  const rows = await listVersionRows(input.db, artifact.id, cursor?.v, input.options.limit + 1);
  const pageRows = rows.slice(0, input.options.limit);
  const items = [];

  for (const row of pageRows) {
    items.push(await formatVersion(input.db, row, false));
  }

  return {
    items,
    next_cursor:
      rows.length > input.options.limit
        ? encodeVersionCursor({ v: pageRows.at(-1)?.version_num ?? 1 })
        : null,
    current_version_num: artifact.version_num,
    total: await countVersions(input.db, artifact.id),
  };
}

export async function getVersionResponse(input: {
  db: DatabaseHandle;
  accountId: string;
  idOrSlug: string;
  versionNum: number;
}): Promise<Record<string, unknown>> {
  const artifact = await resolveLiveArtifact(input.db, input.accountId, input.idOrSlug);
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }

  const version = await findVersion(input.db, artifact.id, input.versionNum);
  if (!version) {
    throw new AppError(404, 'not_found', 'Artifact version not found');
  }

  return formatVersion(input.db, version, true);
}

export async function downloadArtifact(input: {
  db: DatabaseHandle;
  accountId: string;
  idOrSlug: string;
}): Promise<{ body: string; contentType: string; filename: string }> {
  const artifact = await resolveLiveArtifact(input.db, input.accountId, input.idOrSlug);
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }

  const extension = artifact.type === 'markdown' ? 'md' : 'html';
  return {
    body: artifact.content,
    contentType:
      artifact.type === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
    filename: `${artifact.slug}.${extension}`,
  };
}

export async function createShareResponse(input: {
  db: DatabaseHandle;
  cloudModule: CloudModule;
  config: AppConfig;
  auth: AuthPrincipal;
  idOrSlug: string;
  passwordHash?: string;
}): Promise<{ status: 200 | 201; body: Record<string, unknown> }> {
  const artifact = await resolveLiveArtifact(input.db, input.auth.account.id, input.idOrSlug);
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }
  if (input.passwordHash !== undefined) {
    await assertSharePasswordQuota(input.cloudModule, input.auth.account);
  }

  const now = Date.now();
  const existing = await findActiveShare(input.db, artifact.id);
  if (existing) {
    if (input.passwordHash !== undefined) {
      await updateSharePassword(input.db, existing.id, input.passwordHash, now);
    }
    const share = (await findActiveShare(input.db, artifact.id)) ?? existing;
    return {
      status: 200,
      body: await formatShare(input.db, share, input.config.baseUrl, true),
    };
  }

  const shareId = nanoid(22);
  try {
    await insertShare(input.db, shareId, artifact.id, input.passwordHash ?? null, now);
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const raced = await findActiveShare(input.db, artifact.id);
    if (!raced) {
      throw error;
    }
    return { status: 200, body: await formatShare(input.db, raced, input.config.baseUrl, true) };
  }

  const created = await findActiveShare(input.db, artifact.id);
  if (!created) {
    throw new AppError(500, 'internal_error', 'Share was not persisted');
  }
  return { status: 201, body: await formatShare(input.db, created, input.config.baseUrl, false) };
}

export async function patchShareResponse(input: {
  db: DatabaseHandle;
  cloudModule: CloudModule;
  config: AppConfig;
  auth: AuthPrincipal;
  idOrSlug: string;
  passwordHash: string | null;
}): Promise<Record<string, unknown>> {
  const artifact = await resolveLiveArtifact(input.db, input.auth.account.id, input.idOrSlug);
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }
  const share = await findActiveShare(input.db, artifact.id);
  if (!share) {
    throw new AppError(404, 'not_found', 'Active share not found');
  }

  await assertSharePasswordQuota(input.cloudModule, input.auth.account);
  await updateSharePassword(input.db, share.id, input.passwordHash, Date.now());
  const updated = (await findActiveShare(input.db, artifact.id)) ?? share;
  return formatShare(input.db, updated, input.config.baseUrl);
}

export async function deleteShareResponse(input: {
  db: DatabaseHandle;
  accountId: string;
  idOrSlug: string;
}): Promise<Record<string, unknown>> {
  const artifact = await resolveLiveArtifact(input.db, input.accountId, input.idOrSlug);
  if (!artifact) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }

  const changes = await revokeActiveShare(input.db, artifact.id, Date.now());
  return { revoked: changes > 0 };
}

export async function listTemplatesResponse(input: {
  db: DatabaseHandle;
  accountId: string;
  options: ListTemplatesOptions;
}): Promise<Record<string, unknown>> {
  return listTemplatesResponseFromService(input);
}

export async function getTemplateResponse(input: {
  db: DatabaseHandle;
  accountId: string;
  slug: string;
}): Promise<Record<string, unknown>> {
  return getTemplateResponseFromService(input);
}

export async function mergeTemplate(input: {
  db: DatabaseHandle;
  accountId: string;
  slug: string;
  slots?: Record<string, string>;
}): Promise<TemplateMergeResult> {
  return mergeTemplateFromService(input);
}

export function deriveSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

export function parseUpdatedSince(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }

  const asNumber = Number(value);
  if (Number.isInteger(asNumber)) {
    return asNumber;
  }

  const asDate = Date.parse(value);
  if (Number.isNaN(asDate)) {
    throw new AppError(
      400,
      'validation_failed',
      'updated_since must be an ISO timestamp or epoch milliseconds',
      {
        field: 'updated_since',
      }
    );
  }
  return asDate;
}

export function ensureContentLimit(content: string, limit: number): void {
  const actual = Buffer.byteLength(content, 'utf8');
  if (actual > limit) {
    throw new AppError(413, 'payload_too_large', 'Artifact content exceeds the size limit', {
      limit_bytes: limit,
      actual_bytes: actual,
    });
  }
}

export function ensureMetadataLimit(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) {
    return;
  }
  const actual = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
  if (actual > 8 * 1024) {
    throw new AppError(400, 'validation_failed', 'metadata must serialize to 8 KB or less', {
      field: 'metadata',
    });
  }
}

export function parsePositiveVersion(value: string): number {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError(400, 'validation_failed', 'Version number must be an integer >= 1', {
      field: 'n',
    });
  }
  return version;
}

async function formatArtifact(
  db: DatabaseHandle,
  cloudModule: CloudModule,
  account: Account,
  config: AppConfig,
  artifact: ArtifactSnapshot,
  options: { includeContent: boolean; list?: boolean; unchanged?: boolean }
): Promise<Record<string, unknown>> {
  const [bot, share, plan] = await Promise.all([
    artifact.createdByBot ? findBotRef(db, artifact.createdByBot) : Promise.resolve(null),
    findActiveShare(db, artifact.id),
    cloudModule.resolvePlan(account),
  ]);
  const expiresAt = plan.artifact_retention_days
    ? toIso(artifact.updatedAt + plan.artifact_retention_days * dayMs)
    : null;
  const base = {
    id: artifact.id,
    slug: artifact.slug,
    type: artifact.type,
    title: artifact.title,
    ...(options.includeContent
      ? { content: artifact.content }
      : { content_length: Buffer.byteLength(artifact.content, 'utf8') }),
    content_hash: artifact.contentHash,
    metadata: artifact.metadata,
    version_num: artifact.versionNum,
    ...(options.unchanged !== undefined ? { unchanged: options.unchanged } : {}),
    created_by_bot: bot,
    share: options.list
      ? share
        ? formatReducedShare(share, config.baseUrl)
        : null
      : share
        ? await formatArtifactShare(db, share, config.baseUrl)
        : null,
    created_at: toIso(artifact.createdAt),
    updated_at: toIso(artifact.updatedAt),
    ...(options.includeContent ? { expires_at: expiresAt } : {}),
  };
  return base;
}

async function formatVersion(
  db: DatabaseHandle,
  version: VersionRow,
  includeContent: boolean
): Promise<Record<string, unknown>> {
  const bot = version.created_by_bot ? await findBotRef(db, version.created_by_bot) : null;
  return {
    artifact_id: version.artifact_id,
    version_num: version.version_num,
    type: version.type,
    title: version.title,
    ...(includeContent
      ? { content: version.content }
      : { content_length: Buffer.byteLength(version.content, 'utf8') }),
    content_hash: version.content_hash,
    change_summary: version.change_summary,
    restored_from_version: version.restored_from_version,
    created_by_bot: bot,
    created_at: toIso(version.created_at),
  };
}

async function formatShare(
  db: DatabaseHandle,
  share: ShareRow,
  baseUrl: string,
  reused?: boolean
): Promise<Record<string, unknown>> {
  const views = await shareViews(db, share.artifact_id, share);
  return {
    share_id: share.id,
    url: `${baseUrl}/a/${share.id}`,
    artifact_id: share.artifact_id,
    password_protected: share.password_hash !== null,
    ...(reused !== undefined ? { reused } : {}),
    views,
    last_viewed_at: share.last_viewed_at === null ? null : toIso(share.last_viewed_at),
    created_at: toIso(share.created_at),
    expires_at: share.expires_at === null ? null : toIso(share.expires_at),
    revoked_at: share.revoked_at === null ? null : toIso(share.revoked_at),
  };
}

async function formatArtifactShare(
  db: DatabaseHandle,
  share: ShareRow,
  baseUrl: string
): Promise<Record<string, unknown>> {
  return {
    share_id: share.id,
    url: `${baseUrl}/a/${share.id}`,
    password_protected: share.password_hash !== null,
    views: await shareViews(db, share.artifact_id, share),
    created_at: toIso(share.created_at),
    expires_at: share.expires_at === null ? null : toIso(share.expires_at),
  };
}

function formatReducedShare(share: ShareRow, baseUrl: string): Record<string, unknown> {
  return {
    share_id: share.id,
    url: `${baseUrl}/a/${share.id}`,
    password_protected: share.password_hash !== null,
  };
}

function artifactSnapshotFromRow(row: ArtifactRow): ArtifactSnapshot {
  return {
    id: row.id,
    accountId: row.account_id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    metadata: parseJsonObject(row.metadata),
    versionNum: row.version_num,
    createdByBot: row.created_by_bot,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function assertSharePasswordQuota(cloudModule: CloudModule, account: Account): Promise<void> {
  const quota = await cloudModule.checkQuota(account, { type: 'set_share_password' });
  if (!quota.allow) {
    throw new AppError(403, 'quota_exceeded', quota.message, { code: quota.code });
  }
}

function unauthorized(message: string): AppError {
  return new AppError(401, 'unauthorized', message, undefined, { 'WWW-Authenticate': 'Bearer' });
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

async function findBotByHash(
  db: DatabaseHandle,
  apiKeyHash: string
): Promise<{
  id: string;
  name: string;
  byline: string | null;
  account_id: string;
  email: string;
  suspended_at: number | null;
  revoked_at: number | null;
} | null> {
  const sql = `
    SELECT bots.id, bots.name, bots.byline, bots.account_id, bots.revoked_at,
           accounts.email, accounts.suspended_at
    FROM bots
    INNER JOIN accounts ON accounts.id = bots.account_id
    WHERE bots.api_key_hash = ?
  `;

  if (db.dialect === 'sqlite') {
    return (
      (db.sqlite.prepare(sql).get(apiKeyHash) as Awaited<ReturnType<typeof findBotByHash>>) ?? null
    );
  }

  const result = await db.pool.query(sql.replace('?', '$1'), [apiKeyHash]);
  return result.rows[0] ?? null;
}

function throttledLastUsedUpdate(db: DatabaseHandle, botId: string, apiKeyHash: string): void {
  const now = Date.now();
  const last = botLastUsedUpdates.get(apiKeyHash) ?? 0;
  if (now - last < 60_000) {
    return;
  }
  botLastUsedUpdates.set(apiKeyHash, now);

  if (db.dialect === 'sqlite') {
    db.sqlite.prepare('UPDATE bots SET last_used_at = ? WHERE id = ?').run(now, botId);
    return;
  }

  void db.pool.query('UPDATE bots SET last_used_at = $1 WHERE id = $2', [now, botId]);
}

async function findBotRef(db: DatabaseHandle, botId: string): Promise<BotRef | null> {
  if (db.dialect === 'sqlite') {
    return (
      (db.sqlite.prepare('SELECT id, name, byline FROM bots WHERE id = ?').get(botId) as
        | BotRef
        | undefined) ?? null
    );
  }

  const result = await db.pool.query<BotRef>('SELECT id, name, byline FROM bots WHERE id = $1', [
    botId,
  ]);
  return result.rows[0] ?? null;
}

async function resolveLiveArtifact(
  db: DatabaseHandle,
  accountId: string,
  idOrSlug: string
): Promise<ArtifactRow | null> {
  return ARTIFACT_ID_PATTERN.test(idOrSlug)
    ? findLiveArtifactById(db, accountId, idOrSlug)
    : findLiveArtifactBySlug(db, accountId, idOrSlug);
}

async function resolveArtifactIncludingDeleted(
  db: DatabaseHandle,
  accountId: string,
  idOrSlug: string
): Promise<ArtifactRow | null> {
  if (ARTIFACT_ID_PATTERN.test(idOrSlug)) {
    return findArtifactById(db, accountId, idOrSlug);
  }

  return findLatestArtifactBySlug(db, accountId, idOrSlug);
}

async function findLiveArtifactBySlug(
  db: DatabaseHandle,
  accountId: string,
  slug: string
): Promise<ArtifactRow | null> {
  const sql = 'SELECT * FROM artifacts WHERE account_id = ? AND slug = ? AND deleted_at IS NULL';
  return queryOne<ArtifactRow>(db, sql, [accountId, slug]);
}

async function findLiveArtifactById(
  db: DatabaseHandle,
  accountId: string,
  artifactId: string
): Promise<ArtifactRow | null> {
  const sql = 'SELECT * FROM artifacts WHERE account_id = ? AND id = ? AND deleted_at IS NULL';
  return queryOne<ArtifactRow>(db, sql, [accountId, artifactId]);
}

async function findArtifactById(
  db: DatabaseHandle,
  accountId: string,
  artifactId: string
): Promise<ArtifactRow | null> {
  const sql = 'SELECT * FROM artifacts WHERE account_id = ? AND id = ?';
  return queryOne<ArtifactRow>(db, sql, [accountId, artifactId]);
}

async function findLatestArtifactBySlug(
  db: DatabaseHandle,
  accountId: string,
  slug: string
): Promise<ArtifactRow | null> {
  const sql = `
    SELECT *
    FROM artifacts
    WHERE account_id = ? AND slug = ?
    ORDER BY deleted_at IS NULL DESC, updated_at DESC, id DESC
    LIMIT 1
  `;
  return queryOne<ArtifactRow>(db, sql, [accountId, slug]);
}

async function listArtifactsRows(
  db: DatabaseHandle,
  accountId: string,
  options: ListArtifactsOptions,
  cursor: { u: number; id: string } | null,
  limit: number
): Promise<ArtifactRow[]> {
  const clauses = ['account_id = ?', 'deleted_at IS NULL'];
  const params: unknown[] = [accountId];
  if (options.bot) {
    clauses.push('created_by_bot = ?');
    params.push(options.bot);
  }
  if (options.type) {
    clauses.push('type = ?');
    params.push(options.type);
  }
  if (options.updatedSince !== undefined) {
    clauses.push('updated_at > ?');
    params.push(options.updatedSince);
  }
  if (options.q) {
    clauses.push('(lower(title) LIKE lower(?) OR lower(slug) LIKE lower(?))');
    params.push(`%${options.q}%`, `%${options.q}%`);
  }
  if (cursor) {
    clauses.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
    params.push(cursor.u, cursor.u, cursor.id);
  }
  params.push(limit);

  const sql = `
    SELECT *
    FROM artifacts
    WHERE ${clauses.join(' AND ')}
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `;
  return queryAll<ArtifactRow>(db, sql, params);
}

async function listVersionRows(
  db: DatabaseHandle,
  artifactId: string,
  cursorVersion: number | undefined,
  limit: number
): Promise<VersionRow[]> {
  const params: unknown[] = [artifactId];
  const cursorClause = cursorVersion ? 'AND version_num < ?' : '';
  if (cursorVersion) {
    params.push(cursorVersion);
  }
  params.push(limit);
  return queryAll<VersionRow>(
    db,
    `
      SELECT *
      FROM artifact_versions
      WHERE artifact_id = ? ${cursorClause}
      ORDER BY version_num DESC
      LIMIT ?
    `,
    params
  );
}

async function countVersions(db: DatabaseHandle, artifactId: string): Promise<number> {
  const row = await queryOne<{ count: number | string }>(
    db,
    'SELECT count(*) AS count FROM artifact_versions WHERE artifact_id = ?',
    [artifactId]
  );
  return Number(row?.count ?? 0);
}

async function findVersion(
  db: DatabaseHandle,
  artifactId: string,
  versionNum: number
): Promise<VersionRow | null> {
  return queryOne<VersionRow>(
    db,
    'SELECT * FROM artifact_versions WHERE artifact_id = ? AND version_num = ?',
    [artifactId, versionNum]
  );
}

async function findActiveShare(db: DatabaseHandle, artifactId: string): Promise<ShareRow | null> {
  return queryOne<ShareRow>(
    db,
    'SELECT * FROM shares WHERE artifact_id = ? AND revoked_at IS NULL',
    [artifactId]
  );
}

async function insertShare(
  db: DatabaseHandle,
  shareId: string,
  artifactId: string,
  passwordHash: string | null,
  now: number
): Promise<void> {
  await execute(
    db,
    `
      INSERT INTO shares (
        id, artifact_id, password_hash, password_updated_at, expires_at,
        revoked_at, view_count, unique_viewer_count, last_viewed_at, created_at
      )
      VALUES (?, ?, ?, ?, NULL, NULL, 0, 0, NULL, ?)
    `,
    [shareId, artifactId, passwordHash, passwordHash === null ? null : now, now]
  );
}

async function updateSharePassword(
  db: DatabaseHandle,
  shareId: string,
  passwordHash: string | null,
  now: number
): Promise<void> {
  await execute(db, 'UPDATE shares SET password_hash = ?, password_updated_at = ? WHERE id = ?', [
    passwordHash,
    now,
    shareId,
  ]);
}

async function revokeActiveShare(
  db: DatabaseHandle,
  artifactId: string,
  now: number
): Promise<number> {
  return execute(
    db,
    'UPDATE shares SET revoked_at = ? WHERE artifact_id = ? AND revoked_at IS NULL',
    [now, artifactId]
  );
}

async function shareViews(
  db: DatabaseHandle,
  artifactId: string,
  share: ShareRow
): Promise<Record<string, number>> {
  const lifetime = await queryOne<{ total: number | string }>(
    db,
    'SELECT COALESCE(SUM(view_count), 0) AS total FROM shares WHERE artifact_id = ?',
    [artifactId]
  );
  const previous = await queryOne<{ count: number | string }>(
    db,
    'SELECT count(*) AS count FROM shares WHERE artifact_id = ? AND revoked_at IS NOT NULL',
    [artifactId]
  );
  return {
    share_views: share.view_count,
    unique_viewers: share.unique_viewer_count,
    lifetime_views: Number(lifetime?.total ?? 0),
    previous_shares: Number(previous?.count ?? 0),
  };
}

async function queryOne<T extends QueryResultRow>(
  db: DatabaseHandle,
  sql: string,
  params: unknown[]
): Promise<T | null> {
  if (db.dialect === 'sqlite') {
    return (db.sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  const result = await pgQuery<T>(db.pool, sql, params);
  return result.rows[0] ?? null;
}

async function queryAll<T extends QueryResultRow>(
  db: DatabaseHandle,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  if (db.dialect === 'sqlite') {
    return db.sqlite.prepare(sql).all(...params) as T[];
  }

  const result = await pgQuery<T>(db.pool, sql, params);
  return result.rows;
}

async function execute(db: DatabaseHandle, sql: string, params: unknown[]): Promise<number> {
  if (db.dialect === 'sqlite') {
    return Number(db.sqlite.prepare(sql).run(...params).changes);
  }

  const result = await pgQuery(db.pool, sql, params);
  return result.rowCount ?? 0;
}

async function pgQuery<T extends QueryResultRow>(
  executor: PostgresDatabaseHandle['pool'] | PoolClient,
  sql: string,
  params: unknown[]
): Promise<QueryResult<T>> {
  let index = 0;
  const text = sql.replace(/\?/g, () => `$${++index}`);
  return executor.query<T>(text, params);
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'code' in error ? String(error.code) : '';
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505';
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
