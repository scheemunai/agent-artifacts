import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const timestampMs = (name: string) => integer(name, { mode: 'number' });

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    suspendedAt: timestampMs('suspended_at'),
    createdAt: timestampMs('created_at').notNull(),
    updatedAt: timestampMs('updated_at').notNull(),
  },
  (table) => [uniqueIndex('uq_accounts_email').on(table.email)]
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: timestampMs('created_at').notNull(),
    expiresAt: timestampMs('expires_at').notNull(),
    lastSeenAt: timestampMs('last_seen_at'),
  },
  (table) => [
    index('idx_sessions_account').on(table.accountId),
    index('idx_sessions_expires').on(table.expiresAt),
  ]
);

export const magicLinkTokens = sqliteTable(
  'magic_link_tokens',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    createdAt: timestampMs('created_at').notNull(),
    expiresAt: timestampMs('expires_at').notNull(),
    consumedAt: timestampMs('consumed_at'),
  },
  (table) => [
    uniqueIndex('uq_magic_link_token_hash').on(table.tokenHash),
    index('idx_magic_link_expires').on(table.expiresAt),
  ]
);

export const bots = sqliteTable(
  'bots',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    byline: text('byline'),
    apiKeyHash: text('api_key_hash').notNull(),
    apiKeyLast4: text('api_key_last4').notNull(),
    lastUsedAt: timestampMs('last_used_at'),
    revokedAt: timestampMs('revoked_at'),
    createdAt: timestampMs('created_at').notNull(),
    updatedAt: timestampMs('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_bots_api_key_hash').on(table.apiKeyHash),
    index('idx_bots_account').on(table.accountId),
  ]
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    metadata: text('metadata').notNull().default('{}'),
    versionNum: integer('version_num').notNull().default(1),
    createdByBot: text('created_by_bot').references(() => bots.id, { onDelete: 'set null' }),
    deletedAt: timestampMs('deleted_at'),
    createdAt: timestampMs('created_at').notNull(),
    updatedAt: timestampMs('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_artifacts_account_slug_live')
      .on(table.accountId, table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_artifacts_account_list')
      .on(table.accountId, table.updatedAt, table.id)
      .where(sql`${table.deletedAt} IS NULL`),
    index('idx_artifacts_bot').on(table.createdByBot),
    index('idx_artifacts_purge').on(table.deletedAt).where(sql`${table.deletedAt} IS NOT NULL`),
    check('ck_artifacts_type', sql`${table.type} IN ('markdown', 'html')`),
    check('ck_artifacts_version_num', sql`${table.versionNum} >= 1`),
  ]
);

export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    versionNum: integer('version_num').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    changeSummary: text('change_summary'),
    restoredFromVersion: integer('restored_from_version'),
    createdByBot: text('created_by_bot').references(() => bots.id, { onDelete: 'set null' }),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.artifactId, table.versionNum] }),
    check('ck_artifact_versions_type', sql`${table.type} IN ('markdown', 'html')`),
    check('ck_artifact_versions_version_num', sql`${table.versionNum} >= 1`),
  ]
);

export const shares = sqliteTable(
  'shares',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    passwordHash: text('password_hash'),
    passwordUpdatedAt: timestampMs('password_updated_at'),
    expiresAt: timestampMs('expires_at'),
    revokedAt: timestampMs('revoked_at'),
    viewCount: integer('view_count').notNull().default(0),
    uniqueViewerCount: integer('unique_viewer_count').notNull().default(0),
    lastViewedAt: timestampMs('last_viewed_at'),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_shares_artifact_active')
      .on(table.artifactId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('idx_shares_artifact').on(table.artifactId),
  ]
);

export const shareViewers = sqliteTable(
  'share_viewers',
  {
    shareId: text('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    viewerId: text('viewer_id').notNull(),
    firstViewedAt: timestampMs('first_viewed_at').notNull(),
    lastViewedAt: timestampMs('last_viewed_at').notNull(),
    viewCount: integer('view_count').notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.shareId, table.viewerId] })]
);

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    thumbnailUrl: text('thumbnail_url'),
    type: text('type').notNull(),
    content: text('content').notNull(),
    slots: text('slots').notNull(),
    createdFromArtifact: text('created_from_artifact').references(() => artifacts.id, {
      onDelete: 'set null',
    }),
    createdAt: timestampMs('created_at').notNull(),
    updatedAt: timestampMs('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_templates_account_slug')
      .on(table.accountId, table.slug)
      .where(sql`${table.accountId} IS NOT NULL`),
    uniqueIndex('uq_templates_builtin_slug').on(table.slug).where(sql`${table.accountId} IS NULL`),
    index('idx_templates_account').on(table.accountId),
    check('ck_templates_type', sql`${table.type} IN ('markdown', 'html')`),
  ]
);

export const sqliteSchema = {
  accounts,
  sessions,
  magicLinkTokens,
  bots,
  artifacts,
  artifactVersions,
  shares,
  shareViewers,
  templates,
};
