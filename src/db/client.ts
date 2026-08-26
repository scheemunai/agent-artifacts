import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import pg from 'pg';
import type { AppConfig } from '../config.js';
import type { Logger } from '../logger.js';

export type DatabaseDialect = 'sqlite' | 'postgres';

export interface DatabaseHandle {
  dialect: DatabaseDialect;
  close(): Promise<void> | void;
}

export interface SqliteDatabaseHandle extends DatabaseHandle {
  dialect: 'sqlite';
  sqlite: Database.Database;
  db: ReturnType<typeof drizzleSqlite>;
}

export interface PostgresDatabaseHandle extends DatabaseHandle {
  dialect: 'postgres';
  pool: pg.Pool;
}

export async function initializeDatabase(
  config: AppConfig,
  logger: Logger
): Promise<SqliteDatabaseHandle | PostgresDatabaseHandle> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 10,
      statement_timeout: 30_000,
    });
    await pool.query('select 1');
    logger.info({ dialect: 'postgres' }, 'database.ready');
    return {
      dialect: 'postgres',
      pool,
      close: () => pool.end(),
    };
  }

  mkdirSync(dirname(config.sqlitePath), { recursive: true });
  const sqlite = new Database(config.sqlitePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzleSqlite(sqlite);
  logger.info({ dialect: 'sqlite', path: config.sqlitePath }, 'database.ready');

  return {
    dialect: 'sqlite',
    sqlite,
    db,
    close: () => {
      sqlite.close();
    },
  };
}
