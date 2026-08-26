import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import pino from 'pino';
import { loadConfig } from '../../src/config.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Account } from '../../src/extension/cloud-module.js';

export interface TestDatabaseContext {
  cwd: string;
  db: SqliteDatabaseHandle;
  account: Account;
  cleanup(): Promise<void>;
}

export async function createMigratedSqliteContext(): Promise<TestDatabaseContext> {
  const cwd = mkdtempSync(join(tmpdir(), 'aa-db-'));
  const config = loadConfig(
    {
      DEPLOYMENT: 'self-hosted',
      BASE_URL: 'http://localhost:3000',
      AA_SQLITE_PATH: './data/app.db',
      LOG_LEVEL: 'error',
    },
    { cwd }
  );
  const db = (await initializeDatabase(config, pino({ enabled: false }))) as SqliteDatabaseHandle;
  await runMigrations(db, pino({ enabled: false }));

  const account: Account = {
    id: `acc_${nanoid(21)}`,
    email: `agent-${nanoid(8)}@example.test`,
    suspendedAt: null,
  };
  insertAccount(db, account);

  return {
    cwd,
    db,
    account,
    cleanup: async () => {
      await db.close();
      rmSync(cwd, { recursive: true, force: true });
    },
  };
}

export function insertAccount(db: SqliteDatabaseHandle, account: Account): void {
  const now = Date.now();
  db.sqlite
    .prepare(
      `
        INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?)
      `
    )
    .run(account.id, account.email, account.suspendedAt, now, now);
}

export function tableNames(db: SqliteDatabaseHandle): string[] {
  return db.sqlite
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `
    )
    .all()
    .map((row) => (row as { name: string }).name);
}
