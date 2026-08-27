import { resolve } from 'node:path';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { migrate as migratePostgres } from 'drizzle-orm/node-postgres/migrator';
import type { Logger } from '../logger.js';
import { seedStarterTemplates } from '../services/templates.js';
import type { DatabaseHandle } from './client.js';

export async function runMigrations(handle: DatabaseHandle, logger: Logger): Promise<void> {
  const migrationsFolder = resolve(
    process.cwd(),
    handle.dialect === 'sqlite' ? 'drizzle/sqlite' : 'drizzle/postgres'
  );

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
