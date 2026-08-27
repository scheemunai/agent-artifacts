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
