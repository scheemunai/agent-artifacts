import { describe, expect, it } from 'vitest';
import { createMigratedSqliteContext, tableNames } from './db-test-utils.js';

const expectedTables = [
  '__drizzle_migrations',
  'accounts',
  'artifact_versions',
  'artifacts',
  'bots',
  'magic_link_tokens',
  'sessions',
  'share_viewers',
  'shares',
  'templates',
];

describe('SQLite migrations', () => {
  it('apply cleanly from an empty database', async () => {
    const ctx = await createMigratedSqliteContext();

    try {
      expect(tableNames(ctx.db)).toEqual(expectedTables);
      expect(templateColumns(ctx.db)).toContain('thumbnail_url');
    } finally {
      await ctx.cleanup();
    }
  });
});

function templateColumns(
  ctx: Awaited<ReturnType<typeof createMigratedSqliteContext>>['db']
): string[] {
  return ctx.sqlite
    .prepare("PRAGMA table_info('templates')")
    .all()
    .map((row) => (row as { name: string }).name);
}
