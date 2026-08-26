import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrations.js';
import { createMigratedSqliteContext } from './db-test-utils.js';

describe('starter templates', () => {
  it('seed idempotently and keep the canonical report slots required', async () => {
    const ctx = await createMigratedSqliteContext();

    try {
      await runMigrations(ctx.db, pino({ enabled: false }));
      const count = ctx.db.sqlite
        .prepare('SELECT count(*) AS count FROM templates WHERE account_id IS NULL')
        .get() as { count: number };
      const report = ctx.db.sqlite
        .prepare('SELECT slots FROM templates WHERE account_id IS NULL AND slug = ?')
        .get('report') as { slots: string } | undefined;

      expect(count.count).toBe(5);
      expect(report).toBeDefined();
      expect(JSON.parse(report?.slots ?? '[]')).toEqual([
        { name: 'title', description: 'Report title', required: true },
        { name: 'date', description: 'Report date', required: true },
        { name: 'summary', description: 'Executive summary', required: true },
        { name: 'body', description: 'Main report content', required: true },
        { name: 'next_steps', description: 'Recommended next actions', required: true },
      ]);
    } finally {
      await ctx.cleanup();
    }
  });
});
