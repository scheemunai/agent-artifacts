import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrations.js';
import { loadStarterTemplates } from '../../src/services/templates.js';
import { starterTemplateManifest } from '../../templates/manifest.js';
import { createMigratedSqliteContext } from './db-test-utils.js';

describe('starter template manifest seeding', () => {
  it('seeds from templates/manifest.ts idempotently without duplicate rows or content drift', async () => {
    const ctx = await createMigratedSqliteContext();
    const logger = pino({ enabled: false });
    const starters = loadStarterTemplates();
    const report = starters.find((template) => template.slug === 'report');

    try {
      expect(starterTemplateManifest.map((template) => template.slug).sort()).toEqual([
        'briefing',
        'changelog',
        'dashboard',
        'one-pager',
        'report',
      ]);
      expect(report).toBeDefined();

      ctx.db.sqlite
        .prepare("UPDATE templates SET content = 'drifted', slots = '[]' WHERE account_id IS NULL")
        .run();

      await runMigrations(ctx.db, logger);
      await runMigrations(ctx.db, logger);

      const count = ctx.db.sqlite
        .prepare('SELECT count(*) AS count FROM templates WHERE account_id IS NULL')
        .get() as { count: number };
      const rows = ctx.db.sqlite
        .prepare(
          'SELECT slug, content, slots FROM templates WHERE account_id IS NULL ORDER BY slug'
        )
        .all() as Array<{ slug: string; content: string; slots: string }>;

      expect(count.count).toBe(5);
      expect(rows.map((row) => row.slug)).toEqual([
        'briefing',
        'changelog',
        'dashboard',
        'one-pager',
        'report',
      ]);
      for (const row of rows) {
        const starter = starters.find((template) => template.slug === row.slug);
        expect(starter).toBeDefined();
        expect(row.content).toBe(starter?.content);
        expect(JSON.parse(row.slots)).toEqual(starter?.slots);
      }
      expect(JSON.parse(rows.find((row) => row.slug === 'report')?.slots ?? '[]')).toEqual([
        { name: 'title', description: 'Report title', required: true },
        { name: 'date', description: 'Report date', required: true },
        { name: 'summary', description: '2-3 sentence overview', required: true },
        { name: 'body', description: 'Main body', required: true },
        { name: 'next_steps', description: 'Action items / next steps', required: true },
      ]);
    } finally {
      await ctx.cleanup();
    }
  });
});
