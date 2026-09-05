import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const timestampMs = (name: string) => bigint(name, { mode: 'number' });

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    suspendedAt: timestampMs('suspended_at'),
    /** `cus_...`. Written once, on the first upgrade attempt, then permanent. */
    stripeCustomerId: text('stripe_customer_id'),
    /** `sub_...`. NULL means free — there is no zero-amount subscription for the free tier. */
    stripeSubscriptionId: text('stripe_subscription_id'),
    /**
     * Derived entitlement, `free` or `pro`. A CACHE of what Stripe says, written only by the webhook
     * handler, and defaulting to `free` so any row that arrives by a path nobody has thought of yet
     * fails CLOSED.
     *
     * It is a stored column rather than a Stripe API call because `resolvePlan` runs on every
     * dashboard page load AND every public artifact view. Reading it from Stripe would put a network
     * round trip on the public render path and take the whole site down whenever Stripe is slow.
     */
    plan: text('plan').notNull().default('free'),
    /**
     * A manually granted plan that OVERRIDES the Stripe-derived one. Set by an operator, never by a
     * webhook — which is the point: the founder's own account, a comped early user, or a support
     * grant must survive every subscription event, including `deleted`.
     */
    compPlan: text('comp_plan'),
    /**
     * Stamped for every account that existed when billing landed. Grandfathered accounts keep
     * unlimited retention on the free tier forever: they signed up under "artifacts live forever",
     * and a pricing change must not reach backwards and delete what they already published.
     */
    grandfatheredAt: timestampMs('grandfathered_at'),
    /** Raw Stripe status, kept verbatim for support and the past-due banner. */
    subscriptionStatus: text('subscription_status'),
    currentPeriodEnd: timestampMs('current_period_end'),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    /** `event.created` of the last applied webhook. Powers the out-of-order guard. */
    billingUpdatedAt: timestampMs('billing_updated_at'),
    createdAt: timestampMs('created_at').notNull(),
    updatedAt: timestampMs('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_accounts_email').on(table.email),
    // One account, one customer. Duplicate customers per account is the single most common way
    // subscription state goes bad, and it is cheap to make structurally impossible.
    uniqueIndex('uq_accounts_stripe_customer')
      .on(table.stripeCustomerId)
      .where(sql`${table.stripeCustomerId} IS NOT NULL`),
    check('ck_accounts_plan', sql`${table.plan} IN ('free', 'pro')`),
  ]
);

/**
 * Every webhook Stripe has delivered, keyed on its own event id.
 *
 * The primary key IS the idempotency mechanism: Stripe retries any non-2xx for up to three days, so
 * a handler that is not idempotent will eventually double-apply. Insert first, and a conflict means
 * "already seen, return 200 and stop".
 */
export const stripeEvents = pgTable(
  'stripe_events',
  {
    /** Stripe's `evt_...`. */
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    /** `event.created` in ms. Compared against `accounts.billing_updated_at` to drop stale events. */
    stripeCreated: timestampMs('stripe_created').notNull(),
    /** NULL means received but not successfully applied — replayable, and visible in support. */
    processedAt: timestampMs('processed_at'),
    /** Raw JSON for debugging. Purged by the background sweep; this is billing PII. */
    payload: text('payload'),
    createdAt: timestampMs('created_at').notNull(),
  },
  (table) => [
    index('idx_stripe_events_account').on(table.accountId),
    index('idx_stripe_events_created').on(table.createdAt),
  ]
);

export const sessions = pgTable(
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

export const magicLinkTokens = pgTable(
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

export const bots = pgTable(
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

export const artifacts = pgTable(
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

export const artifactVersions = pgTable(
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

export const shares = pgTable(
  'shares',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    /**
     * Who may open this URL: `private` (the owner, signed in) · `public` · `password`.
     *
     * Defaults to `private` at the database level so a row written by any path that forgets to set
     * it fails CLOSED. The column carries the enum check inline; the cross-column invariant
     * (`password` implies a stored hash) is enforced by the one writer in ArtifactService, because
     * SQLite cannot add a table-level CHECK to an existing table without rebuilding it and the two
     * dialects are kept identical on purpose.
     */
    visibility: text('visibility').notNull().default('private'),
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

export const shareViewers = pgTable(
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

/**
 * The raw read log — one row per counted read of a shared artifact.
 *
 * NO PRIMARY KEY, deliberately. This is an append-only log: a generated id would cost a nanoid per
 * write and buy nothing, since nothing ever addresses a single row. Reads are ranged scans and the
 * purge is `WHERE day < ?`.
 *
 * NOTHING HERE IDENTIFIES A PERSON. `visitor_hash` is a salted digest whose salt is destroyed
 * within 48 hours (see `analytics_salts`), so two days of rows cannot be joined and no row can be
 * reversed to an IP. That is the property that makes the privacy policy's "cookieless" claim true.
 */
export const viewEvents = pgTable(
  'view_events',
  {
    shareId: text('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    artifactId: text('artifact_id').notNull(),
    accountId: text('account_id').notNull(),
    at: timestampMs('at').notNull(),
    /** UTC YYYYMMDD. Grouping and retention both key on it, and neither wants date arithmetic. */
    day: integer('day').notNull(),
    visitorHash: text('visitor_hash').notNull(),
    versionNum: integer('version_num').notNull(),
    /** Host only, never a path or query string. NULL means direct, or our own page. */
    referrerHost: text('referrer_host'),
    device: text('device'),
    /** Quality signal only: the reader ran our script. It never creates or removes a view. */
    jsConfirmed: boolean('js_confirmed').notNull().default(false),
  },
  (table) => [
    index('idx_view_events_account_at').on(table.accountId, table.at),
    index('idx_view_events_artifact_at').on(table.artifactId, table.at),
    index('idx_view_events_day').on(table.day),
  ]
);

/**
 * One row the first time a hash reads a share on a day — the thing that makes "visitors" countable
 * without a SELECT-then-INSERT race.
 *
 * Two replicas flushing the same reader's first view would both find no row and both increment the
 * counter. A primary key plus `ON CONFLICT DO NOTHING` makes the question atomic instead: whoever
 * inserts the row counted the visitor, and the loser's insert is a no-op rather than an error. This
 * is the same conflict-free shape the cookie ledger it replaces used, minus the cookie.
 *
 * Purged on the same 90-day sweep as the events, so it can never outlive the salt that made it.
 */
export const shareVisitorDays = pgTable(
  'share_visitor_days',
  {
    shareId: text('share_id')
      .notNull()
      .references(() => shares.id, { onDelete: 'cascade' }),
    day: integer('day').notNull(),
    visitorHash: text('visitor_hash').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.shareId, table.day, table.visitorHash] }),
    index('idx_share_visitor_days_day').on(table.day),
  ]
);

/**
 * One secret per UTC day, shared by every process so replicas derive the same hash for the same
 * reader. Swept at 48 hours by the background scheduler, which is what makes yesterday's hashes
 * permanently unlinkable to today's.
 */
export const analyticsSalts = pgTable(
  'analytics_salts',
  {
    day: integer('day').notNull(),
    salt: text('salt').notNull(),
    createdAt: timestampMs('created_at').notNull(),
  },
  // A TABLE-level key, not `.primaryKey()` on the column: in SQLite `INTEGER PRIMARY KEY` is an
  // alias for the rowid and auto-assigns, which is the opposite of what this column is — the day
  // is supplied, never generated. The constraint form keeps both dialects describing one thing.
  (table) => [primaryKey({ columns: [table.day] })]
);

export const templates = pgTable(
  'templates',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    thumbnailUrl: text('thumbnail_url'),
    category: text('category'),
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

export const postgresSchema = {
  accounts,
  stripeEvents,
  sessions,
  magicLinkTokens,
  bots,
  artifacts,
  artifactVersions,
  shares,
  shareViewers,
  viewEvents,
  shareVisitorDays,
  analyticsSalts,
  templates,
};
