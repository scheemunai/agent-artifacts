import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrations.js';
import { loadStarterTemplates } from '../../src/services/templates.js';
import { starterTemplateManifest } from '../../templates/manifest.js';
import { createMigratedSqliteContext } from './db-test-utils.js';

interface StarterTemplateSeedRow {
  slug: string;
  content: string;
  slots: string;
  thumbnail_url: string | null;
}

describe('starter template manifest seeding', () => {
  it('seeds from templates/manifest.ts idempotently without duplicate rows or content drift', async () => {
    const ctx = await createMigratedSqliteContext();
    const logger = pino({ enabled: false });
    const starters = loadStarterTemplates();
    const report = starters.find((template) => template.slug === 'report');

    try {
      // Deliberately literal: this is the tripwire that says the built-in lineup changed. Deriving
      // it from the manifest would make it assert nothing.
      expect(starterTemplateManifest.map((template) => template.slug).sort()).toEqual([
        'case-study',
        'changelog',
        'checklist',
        'daily-digest',
        'dashboard',
        'decision-brief',
        'interview-notes',
        'launch-announcement',
        'meeting-recap',
        'metrics-dashboard',
        'migration-guide',
        'one-pager',
        'postmortem',
        'project-plan',
        'project-status',
        'proposal',
        'report',
        'report-html',
        'research-brief',
        'runbook',
        'service-health',
        'spec',
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
          'SELECT slug, content, slots, thumbnail_url FROM templates WHERE account_id IS NULL ORDER BY slug'
        )
        .all() as StarterTemplateSeedRow[];

      // Same source as the seeder, for the same reason the Postgres suite now derives it: a
      // hard-coded count is a copy of the manifest that nobody updates when the manifest changes.
      expect(count.count).toBe(loadStarterTemplates().length);
      // What the seeder owes is the manifest, so compare against the manifest (the tripwire above
      // already pins what the manifest itself is allowed to be).
      expect(rows.map((row) => row.slug)).toEqual(starters.map((t) => t.slug).sort());
      for (const row of rows) {
        const starter = starters.find((template) => template.slug === row.slug);
        expect(starter).toBeDefined();
        expect(row.content).toBe(starter?.content);
        expect(JSON.parse(row.slots)).toEqual(starter?.slots);
        expect(row.thumbnail_url).toBe(starter?.thumbnail ?? null);
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

  it('points every starter thumbnail at a committed file under public/assets/template-thumbs', () => {
    // `scripts/build-template-thumbs.mjs` writes these and the manifest names them; nothing at
    // runtime checks that the two agree. A manifest entry whose thumbnail 404s is a broken image
    // in the template picker, which is exactly the surface the thumbnails exist for.
    for (const starter of loadStarterTemplates()) {
      expect(starter.thumbnail).toBe(`/assets/template-thumbs/${starter.slug}.png`);
      expect(
        existsSync(
          fileURLToPath(
            new URL(`../../public/assets/template-thumbs/${starter.slug}.png`, import.meta.url)
          )
        )
      ).toBe(true);
    }
  });

  it('loads unique starter manifests with html, thumbnails, and omitted slots', () => {
    const root = mkdtempSync(join(tmpdir(), 'aa-template-manifest-'));
    const templatesDir = join(root, 'templates');
    mkdirSync(templatesDir);

    try {
      const entries = Array.from({ length: 5 }, (_, index) => {
        const slug = index === 0 ? 'html-example' : `example-${index}`;
        const contentFile = `${slug}.${index === 0 ? 'html' : 'md'}`;
        writeFileSync(
          join(templatesDir, contentFile),
          index === 0 ? '<main>{{ raw_html_marker }}</main>' : `# Example ${index}`,
          'utf8'
        );
        return {
          slug,
          name: `Example ${index}`,
          description: `Example ${index}`,
          // Every manifest entry declares the job it does; the schema is a closed set precisely so a
          // typo cannot produce an empty section on the public browse page.
          category: 'research',
          type: index === 0 ? 'html' : 'markdown',
          ...(index === 0 ? { thumbnail: '/assets/templates/html-example.png' } : {}),
          content_file: contentFile,
          ...(index === 0
            ? {}
            : {
                slots: [{ name: 'title', description: 'Title', required: true }],
              }),
        };
      });
      writeFileSync(
        join(templatesDir, 'manifest.ts'),
        `export const starterTemplateManifest = ${JSON.stringify(entries, null, 2)} as const;\n`,
        'utf8'
      );

      expect(loadStarterTemplates(root)[0]).toMatchObject({
        slug: 'html-example',
        type: 'html',
        thumbnail: '/assets/templates/html-example.png',
        content: '<main>{{ raw_html_marker }}</main>',
        slots: [],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
