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
