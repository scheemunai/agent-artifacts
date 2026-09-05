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
    const onePager = starters.find((template) => template.slug === 'one-pager');

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
        'research-brief',
        'runbook',
        'service-health',
        'spec',
      ]);
      expect(onePager).toBeDefined();

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
      expect(JSON.parse(rows.find((row) => row.slug === 'one-pager')?.slots ?? '[]')).toEqual([
        { name: 'title', description: 'Page title', required: true },
        { name: 'subtitle', description: 'Subtitle or positioning line', required: true },
        { name: 'body', description: 'Main page content', required: true },
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

  /**
   * The test shape that was missing all day: every other seed test starts from an EMPTY database,
   * which is the one situation production is never in. Seeding the old lineup first is what found
   * that retired built-ins survived a deploy — and that a surviving `recap` row beats its own alias,
   * because `resolveTemplate` matches exactly before it follows a retirement.
   */
  it('removes built-ins whose slug has left the manifest, and leaves account templates alone', async () => {
    const ctx = await createMigratedSqliteContext();
    const logger = pino({ enabled: false });

    try {
      const now = Date.now();
      const insert = ctx.db.sqlite.prepare(
        `INSERT INTO templates (id, account_id, slug, name, description, type, content, slots, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
      );
      // Three slugs this build retires, as a previous deploy would have left them.
      for (const slug of ['recap', 'briefing', 'report-html']) {
        ctx.db.sqlite
          .prepare('DELETE FROM templates WHERE slug = ? AND account_id IS NULL')
          .run(slug);
        insert.run(`tpl_ghost_${slug}`, null, slug, slug, 'stale', 'markdown', '# stale', now, now);
      }
      // And an account's own template, which must survive untouched — the DELETE is scoped to
      // built-ins, and getting that wrong would destroy customer data on every boot.
      ctx.db.sqlite
        .prepare(
          `INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
           VALUES ('acc_someone', 'someone@example.test', 'x', NULL, ?, ?)`
        )
        .run(now, now);
      insert.run(
        'tpl_mine',
        'acc_someone',
        'my-own-thing',
        'Mine',
        'mine',
        'markdown',
        '# mine',
        now,
        now
      );

      await runMigrations(ctx.db, logger);

      const builtIns = ctx.db.sqlite
        .prepare('SELECT slug FROM templates WHERE account_id IS NULL ORDER BY slug')
        .all() as Array<{ slug: string }>;
      expect(builtIns.map((row) => row.slug)).toEqual(
        loadStarterTemplates()
          .map((template) => template.slug)
          .sort()
      );
      for (const gone of ['recap', 'briefing', 'report-html']) {
        expect(
          builtIns.map((row) => row.slug),
          `${gone} survived the deploy`
        ).not.toContain(gone);
      }

      const mine = ctx.db.sqlite
        .prepare("SELECT slug, content FROM templates WHERE account_id = 'acc_someone'")
        .all() as Array<{ slug: string; content: string }>;
      expect(mine).toEqual([{ slug: 'my-own-thing', content: '# mine' }]);
    } finally {
      await ctx.cleanup();
    }
  });
});
