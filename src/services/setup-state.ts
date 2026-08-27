import Database from 'better-sqlite3';
import type { AppConfig } from '../config.js';

export function selfHostedEntryPath(
  config: Pick<AppConfig, 'databaseUrl' | 'sqlitePath'>
): '/setup' | '/login' {
  if (config.databaseUrl) {
    return '/login';
  }

  return sqliteHasAccounts(config.sqlitePath) ? '/login' : '/setup';
}

export function sqliteHasAccounts(sqlitePath: string): boolean {
  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    const row = sqlite.prepare('SELECT count(*) AS count FROM accounts').get() as
      | { count: number }
      | undefined;
    return Number(row?.count ?? 0) > 0;
  } catch {
    return false;
  } finally {
    sqlite?.close();
  }
}
