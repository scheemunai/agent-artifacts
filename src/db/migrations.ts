import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator';
import { resolveShippedPath } from '../lib/runtime-paths.js';
import type { Logger } from '../logger.js';
import { seedStarterTemplates } from '../services/templates.js';
import type { DatabaseHandle } from './client.js';

export async function runMigrations(handle: DatabaseHandle, logger: Logger): Promise<void> {
  // Resolved from the installation, not the working directory: booting from anywhere else used to
  // die inside drizzle with "Can't find meta/_journal.json file" and no path in the message.
  const migrationsFolder = resolveMigrationsFolder(handle.dialect);

  logger.info(
    { dialect: handle.dialect, migrations_folder: migrationsFolder },
    'database.migrate.start'
  );

  if (handle.dialect === 'sqlite') {
    migrateSqlite(handle.db, { migrationsFolder });
  } else {
    await migratePostgres(handle.db, { migrationsFolder });
  }

  await applyForwardMigrations(handle, logger);
  await seedStarterTemplates(handle, logger);
  logger.info({ dialect: handle.dialect }, 'database.migrate.complete');
}

export function resolveMigrationsFolder(dialect: DatabaseHandle['dialect']): string {
  return resolveShippedPath({
    what: `${dialect} database migrations`,
    relative: dialect === 'sqlite' ? 'drizzle/sqlite' : 'drizzle/postgres',
    fix: 'from a source checkout run `pnpm run db:generate`; in a container the image must ship drizzle/',
  });
}

async function applyForwardMigrations(handle: DatabaseHandle, logger: Logger): Promise<void> {
  await ensureTemplateThumbnailUrl(handle, logger);
  await ensureTemplateCategory(handle, logger);
  await ensureShareVisibility(handle, logger);
  await ensureBillingColumns(handle, logger);
  await ensureStripeEventsTable(handle, logger);
  await ensureAnalyticsTables(handle, logger);
}

/**
 * Billing columns on `accounts`, plus THE GRANDFATHER STAMP, which is the part that matters.
 *
 * `plan` defaults to `free`, so the column add alone is harmless: every existing row becomes a free
 * account, which is what they all already were. That is the opposite of `ensureShareVisibility`
 * below, where the default would have changed live behaviour and a backfill was mandatory.
 *
 * The DANGER here is one step further out. Before billing, every plan returned
 * `artifact_retention_days: null`, so the retention sweep in `services/scheduler.ts` never deleted
 * anything — it was inert. Giving the free tier a 7-day window ARMS it, and the next sweep would
 * soft-delete every free artifact older than a week and revoke its share links. People who signed up
 * under "artifacts live forever" would watch links they had already sent to other people go dark.
 *
 * So this stamps `grandfathered_at` on every account that exists RIGHT NOW. `BillingModule`
 * gives those accounts unlimited retention forever, even on free. New accounts created after this
 * migration get NULL and are subject to the published 7-day policy.
 *
 * It runs only on the branch that adds the column, so a later boot cannot re-stamp accounts that
 * have since signed up under the new terms.
 */
async function ensureBillingColumns(handle: DatabaseHandle, logger: Logger): Promise<void> {
  const columns: Array<[string, string]> = [
    ['stripe_customer_id', 'TEXT'],
    ['stripe_subscription_id', 'TEXT'],
    ['plan', "TEXT NOT NULL DEFAULT 'free'"],
    ['comp_plan', 'TEXT'],
    ['grandfathered_at', 'BIGINT'],
    ['subscription_status', 'TEXT'],
    ['current_period_end', 'BIGINT'],
    ['cancel_at_period_end', 'BOOLEAN NOT NULL DEFAULT FALSE'],
    ['billing_updated_at', 'BIGINT'],
  ];
  const now = Date.now();

  if (handle.dialect === 'sqlite') {
    const existing = handle.sqlite.prepare("PRAGMA table_info('accounts')").all() as Array<{
      name: string;
    }>;
    if (existing.some((column) => column.name === 'plan')) {
      return;
    }

    // SQLite has no BOOLEAN and stores it as INTEGER; BIGINT is an INTEGER affinity alias. Spelling
    // the types per dialect keeps the two schema files describing the same shape.
    const sqliteTypes: Record<string, string> = {
      'BOOLEAN NOT NULL DEFAULT FALSE': 'INTEGER NOT NULL DEFAULT 0',
      BIGINT: 'INTEGER',
    };

    for (const [name, type] of columns) {
      try {
        handle.sqlite
          .prepare(`ALTER TABLE accounts ADD COLUMN ${name} ${sqliteTypes[type] ?? type}`)
          .run();
      } catch (error) {
        if (!isDuplicateColumnError(error)) {
          throw error;
        }
      }
    }

    handle.sqlite
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_stripe_customer
           ON accounts (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`
      )
      .run();

    const stamped = handle.sqlite
      .prepare('UPDATE accounts SET grandfathered_at = ? WHERE grandfathered_at IS NULL')
      .run(now);
    logger.info(
      {
        dialect: handle.dialect,
        migration: 'accounts.billing',
        grandfathered_accounts: stamped.changes,
      },
      'database.forward_migration.applied'
    );
    return;
  }

  const existing = await handle.pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'accounts' AND column_name = 'plan'`
  );
  if ((existing.rowCount ?? 0) > 0) {
    return;
  }

  for (const [name, type] of columns) {
    await handle.pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }

  await handle.pool.query(
    `ALTER TABLE accounts ADD CONSTRAINT ck_accounts_plan CHECK (plan IN ('free', 'pro'))`
  );
  await handle.pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_stripe_customer
       ON accounts (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`
  );

  const stamped = await handle.pool.query(
    'UPDATE accounts SET grandfathered_at = $1 WHERE grandfathered_at IS NULL',
    [now]
  );
  logger.info(
    {
      dialect: handle.dialect,
      migration: 'accounts.billing',
      grandfathered_accounts: stamped.rowCount ?? 0,
    },
    'database.forward_migration.applied'
  );
}

/**
 * The webhook ledger. Created here rather than through `db:generate` because this repo keeps a
 * single `0000_init` drizzle snapshot and puts every subsequent change in a forward migration —
 * regenerating the snapshot would rewrite a migration that deployed databases have already applied.
 *
 * The primary key on Stripe's own `evt_...` is the idempotency mechanism, so the table has to exist
 * before the first webhook can be trusted.
 */
async function ensureStripeEventsTable(handle: DatabaseHandle, logger: Logger): Promise<void> {
  if (handle.dialect === 'sqlite') {
    handle.sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS stripe_events (
           id TEXT PRIMARY KEY,
           type TEXT NOT NULL,
           account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
           stripe_created INTEGER NOT NULL,
           processed_at INTEGER,
           payload TEXT,
           created_at INTEGER NOT NULL
         )`
      )
      .run();
    handle.sqlite
      .prepare('CREATE INDEX IF NOT EXISTS idx_stripe_events_account ON stripe_events (account_id)')
      .run();
    handle.sqlite
      .prepare('CREATE INDEX IF NOT EXISTS idx_stripe_events_created ON stripe_events (created_at)')
      .run();
    logger.info(
      { dialect: handle.dialect, migration: 'stripe_events' },
      'database.forward_migration.applied'
    );
    return;
  }

  await handle.pool.query(
    `CREATE TABLE IF NOT EXISTS stripe_events (
       id TEXT PRIMARY KEY,
       type TEXT NOT NULL,
       account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
       stripe_created BIGINT NOT NULL,
       processed_at BIGINT,
       payload TEXT,
       created_at BIGINT NOT NULL
     )`
  );
  await handle.pool.query(
    'CREATE INDEX IF NOT EXISTS idx_stripe_events_account ON stripe_events (account_id)'
  );
  await handle.pool.query(
    'CREATE INDEX IF NOT EXISTS idx_stripe_events_created ON stripe_events (created_at)'
  );
  logger.info(
    { dialect: handle.dialect, migration: 'stripe_events' },
    'database.forward_migration.applied'
  );
}

/**
 * The analytics store: the raw read log and the daily hashing salts.
 *
 * Created here rather than through `db:generate` for the reason `ensureStripeEventsTable` states —
 * this repo keeps one frozen `0000_init` snapshot and puts every later change in a forward
 * migration, because regenerating the snapshot rewrites a migration deployed databases have already
 * applied. `CREATE TABLE IF NOT EXISTS` makes it idempotent on every boot.
 *
 * NOTE WHAT IS NOT HERE: no backfill. There is no way to reconstruct who read an artifact before we
 * started recording it, so the time series legitimately begins at the cutover. The lifetime totals
 * on `shares` carry the pre-history instead, and keep being incremented — see `AnalyticsRecorder`.
 */
async function ensureAnalyticsTables(handle: DatabaseHandle, logger: Logger): Promise<void> {
  if (handle.dialect === 'sqlite') {
    handle.sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS view_events (
           share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
           artifact_id TEXT NOT NULL,
           account_id TEXT NOT NULL,
           at INTEGER NOT NULL,
           day INTEGER NOT NULL,
           visitor_hash TEXT NOT NULL,
           version_num INTEGER NOT NULL,
           referrer_host TEXT,
           device TEXT,
           js_confirmed INTEGER NOT NULL DEFAULT 0
         )`
      )
      .run();
    for (const [name, columns] of VIEW_EVENT_INDEXES) {
      handle.sqlite.prepare(`CREATE INDEX IF NOT EXISTS ${name} ON view_events (${columns})`).run();
    }
    handle.sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS share_visitor_days (
           share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
           day INTEGER NOT NULL,
           visitor_hash TEXT NOT NULL,
           PRIMARY KEY (share_id, day, visitor_hash)
         )`
      )
      .run();
    handle.sqlite
      .prepare('CREATE INDEX IF NOT EXISTS idx_share_visitor_days_day ON share_visitor_days (day)')
      .run();
    handle.sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS analytics_salts (
           day INTEGER NOT NULL,
           salt TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           PRIMARY KEY (day)
         )`
      )
      .run();
    logger.info(
      { dialect: handle.dialect, migration: 'analytics' },
      'database.forward_migration.applied'
    );
    return;
  }

  await handle.pool.query(
    `CREATE TABLE IF NOT EXISTS view_events (
       share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
       artifact_id TEXT NOT NULL,
       account_id TEXT NOT NULL,
       at BIGINT NOT NULL,
       day INTEGER NOT NULL,
       visitor_hash TEXT NOT NULL,
       version_num INTEGER NOT NULL,
       referrer_host TEXT,
       device TEXT,
       js_confirmed BOOLEAN NOT NULL DEFAULT FALSE
     )`
  );
  for (const [name, columns] of VIEW_EVENT_INDEXES) {
    await handle.pool.query(`CREATE INDEX IF NOT EXISTS ${name} ON view_events (${columns})`);
  }
  await handle.pool.query(
    `CREATE TABLE IF NOT EXISTS share_visitor_days (
       share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
       day INTEGER NOT NULL,
       visitor_hash TEXT NOT NULL,
       PRIMARY KEY (share_id, day, visitor_hash)
     )`
  );
  await handle.pool.query(
    'CREATE INDEX IF NOT EXISTS idx_share_visitor_days_day ON share_visitor_days (day)'
  );
  await handle.pool.query(
    `CREATE TABLE IF NOT EXISTS analytics_salts (
       day INTEGER NOT NULL,
       salt TEXT NOT NULL,
       created_at BIGINT NOT NULL,
       PRIMARY KEY (day)
     )`
  );
  logger.info(
    { dialect: handle.dialect, migration: 'analytics' },
    'database.forward_migration.applied'
  );
}

/**
 * Three, and each one earns its write cost on a table written once per read: the stats home ranges
 * by account, the artifact panel by artifact, and the retention sweep deletes by day alone.
 * Uniqueness needs no index here — `share_visitor_days` answers it from its primary key.
 */
const VIEW_EVENT_INDEXES: ReadonlyArray<readonly [string, string]> = [
  ['idx_view_events_account_at', 'account_id, at'],
  ['idx_view_events_artifact_at', 'artifact_id, at'],
  ['idx_view_events_day', 'day'],
];

/**
 * Adds `shares.visibility` and — ON THE ADD, ONCE — records what every existing share already is.
 *
 * THE BACKFILL IS THE WHOLE POINT, and it is not "opting old artifacts in". Before this column
 * existed, a share row was only ever created by an explicit `share:true` or a password, so every
 * row in the table is a link that is live on the internet RIGHT NOW. Adding the column with its
 * `private` default and stopping there would take every one of those links dark on the deploy that
 * shipped it — including the ones people have already sent to other people. The UPDATE writes down
 * the state each row is in, so nothing changes visibility on deploy.
 *
 * It runs only on the branch that adds the column, so a later boot cannot re-run it and re-publish
 * something the owner has since made private.
 *
 * `private` is the column default rather than `public` so that anything which reaches this table by
 * a path nobody has thought of yet fails CLOSED.
 */
async function ensureShareVisibility(handle: DatabaseHandle, logger: Logger): Promise<void> {
  const backfill = `
    UPDATE shares
    SET visibility = CASE WHEN password_hash IS NOT NULL THEN 'password' ELSE 'public' END
  `;

  if (handle.dialect === 'sqlite') {
    const columns = handle.sqlite.prepare("PRAGMA table_info('shares')").all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === 'visibility')) {
      return;
    }

    try {
      handle.sqlite
        .prepare(
          `ALTER TABLE shares ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
             CHECK (visibility IN ('private', 'public', 'password'))`
        )
        .run();
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error;
      }
      return;
    }

    const updated = handle.sqlite.prepare(backfill).run();
    logger.info(
      { dialect: handle.dialect, migration: 'shares.visibility', backfilled: updated.changes },
      'database.forward_migration.applied'
    );
    return;
  }

  const existing = await handle.pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'shares' AND column_name = 'visibility'`
  );
  if ((existing.rowCount ?? 0) > 0) {
    return;
  }

  await handle.pool.query(
    `ALTER TABLE shares ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
       CHECK (visibility IN ('private', 'public', 'password'))`
  );
  const updated = await handle.pool.query(backfill);
  logger.info(
    { dialect: handle.dialect, migration: 'shares.visibility', backfilled: updated.rowCount ?? 0 },
    'database.forward_migration.applied'
  );
}

async function ensureTemplateThumbnailUrl(handle: DatabaseHandle, logger: Logger): Promise<void> {
  if (handle.dialect === 'sqlite') {
    const columns = handle.sqlite.prepare("PRAGMA table_info('templates')").all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === 'thumbnail_url')) {
      return;
    }

    try {
      handle.sqlite.prepare('ALTER TABLE templates ADD COLUMN thumbnail_url TEXT').run();
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error;
      }
    }
    logger.info(
      { dialect: handle.dialect, migration: 'templates.thumbnail_url' },
      'database.forward_migration.applied'
    );
    return;
  }

  await handle.pool.query('ALTER TABLE templates ADD COLUMN IF NOT EXISTS thumbnail_url TEXT');
}

/**
 * `templates.category` — the job a template does, and the axis the public browse page groups by.
 *
 * Nullable on purpose. Built-ins are re-seeded on every boot and always carry a category from the
 * manifest, so the only rows that can arrive here without one are account templates promoted before
 * this column existed. They are read through `DEFAULT_TEMPLATE_CATEGORY` rather than backfilled: a
 * backfill would put every one of somebody's old templates into a category we guessed, which is a
 * decision about their content that we are not in a position to make. Reading a default is
 * reversible the moment they set one; writing one is not.
 */
async function ensureTemplateCategory(handle: DatabaseHandle, logger: Logger): Promise<void> {
  if (handle.dialect === 'sqlite') {
    const columns = handle.sqlite.prepare("PRAGMA table_info('templates')").all() as Array<{
      name: string;
    }>;
    if (columns.some((column) => column.name === 'category')) {
      return;
    }

    try {
      handle.sqlite.prepare('ALTER TABLE templates ADD COLUMN category TEXT').run();
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error;
      }
    }
    logger.info(
      { dialect: handle.dialect, migration: 'templates.category' },
      'database.forward_migration.applied'
    );
    return;
  }

  await handle.pool.query('ALTER TABLE templates ADD COLUMN IF NOT EXISTS category TEXT');
}

function isDuplicateColumnError(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message);
}
