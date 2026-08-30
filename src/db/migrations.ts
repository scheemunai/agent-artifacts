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
  await ensureShareVisibility(handle, logger);
}

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

function isDuplicateColumnError(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message);
}
