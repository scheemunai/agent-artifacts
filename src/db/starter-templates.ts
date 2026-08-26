import { nanoid } from 'nanoid';
import type { Logger } from '../logger.js';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from './client.js';

export interface TemplateSlot {
  name: string;
  description: string;
  required: boolean;
}

export interface StarterTemplate {
  slug: string;
  name: string;
  description: string;
  type: 'markdown' | 'html';
  content: string;
  slots: TemplateSlot[];
}

export const starterTemplates: StarterTemplate[] = [
  {
    slug: 'report',
    name: 'Report',
    description: 'A concise report with summary, body, and next steps.',
    type: 'markdown',
    content: [
      '# {{title}}',
      '',
      '_{{date}}_',
      '',
      '## Summary',
      '{{summary}}',
      '',
      '## Details',
      '{{body}}',
      '',
      '## Next steps',
      '{{next_steps}}',
    ].join('\n'),
    slots: [
      { name: 'title', description: 'Report title', required: true },
      { name: 'date', description: 'Report date', required: true },
      { name: 'summary', description: 'Executive summary', required: true },
      { name: 'body', description: 'Main report content', required: true },
      { name: 'next_steps', description: 'Recommended next actions', required: true },
    ],
  },
  {
    slug: 'dashboard',
    name: 'Dashboard',
    description: 'A lightweight markdown dashboard for recurring metrics.',
    type: 'markdown',
    content: [
      '# {{title}}',
      '',
      '_Updated {{updated}}_',
      '',
      '## Metrics',
      '{{metrics}}',
      '',
      '## Details',
      '{{details}}',
    ].join('\n'),
    slots: [
      { name: 'title', description: 'Dashboard title', required: true },
      { name: 'updated', description: 'Last updated timestamp', required: true },
      { name: 'metrics', description: 'Metric bullets or table', required: true },
      { name: 'details', description: 'Additional context', required: true },
    ],
  },
  {
    slug: 'changelog',
    name: 'Changelog',
    description: 'Release notes with added, changed, and fixed sections.',
    type: 'markdown',
    content: [
      '# {{title}}',
      '',
      'Version {{version}} — {{date}}',
      '',
      '## Added',
      '{{added}}',
      '',
      '## Changed',
      '{{changed}}',
      '',
      '## Fixed',
      '{{fixed}}',
    ].join('\n'),
    slots: [
      { name: 'title', description: 'Changelog title', required: true },
      { name: 'version', description: 'Release version', required: true },
      { name: 'date', description: 'Release date', required: true },
      { name: 'added', description: 'Added items', required: true },
      { name: 'changed', description: 'Changed items', required: true },
      { name: 'fixed', description: 'Fixed items', required: true },
    ],
  },
  {
    slug: 'briefing',
    name: 'Briefing',
    description: 'A decision-ready briefing note.',
    type: 'markdown',
    content: [
      '# {{title}}',
      '',
      '_{{date}}_',
      '',
      '## TL;DR',
      '{{tldr}}',
      '',
      '## Briefing',
      '{{sections}}',
    ].join('\n'),
    slots: [
      { name: 'title', description: 'Briefing title', required: true },
      { name: 'date', description: 'Briefing date', required: true },
      { name: 'tldr', description: 'Short takeaway', required: true },
      { name: 'sections', description: 'Briefing sections', required: true },
    ],
  },
  {
    slug: 'one-pager',
    name: 'One-pager',
    description: 'A simple one-page artifact shell.',
    type: 'markdown',
    content: ['# {{title}}', '', '_{{subtitle}}_', '', '{{body}}'].join('\n'),
    slots: [
      { name: 'title', description: 'Page title', required: true },
      { name: 'subtitle', description: 'Subtitle or positioning line', required: true },
      { name: 'body', description: 'Main page content', required: true },
    ],
  },
];

export async function seedStarterTemplates(
  handle: DatabaseHandle,
  logger: Logger
): Promise<{ insertedOrUpdated: number }> {
  if (handle.dialect === 'sqlite') {
    return seedSqliteStarterTemplates(handle, logger);
  }

  return seedPostgresStarterTemplates(handle, logger);
}

function seedSqliteStarterTemplates(
  handle: SqliteDatabaseHandle,
  logger: Logger
): { insertedOrUpdated: number } {
  const now = Date.now();
  const seed = handle.sqlite.transaction(() => {
    const upsert = handle.sqlite.prepare(`
      INSERT INTO templates (
        id, account_id, slug, name, description, type, content, slots,
        created_from_artifact, created_at, updated_at
      )
      VALUES (@id, NULL, @slug, @name, @description, @type, @content, @slots, NULL, @now, @now)
      ON CONFLICT(slug) WHERE account_id IS NULL DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        type = excluded.type,
        content = excluded.content,
        slots = excluded.slots,
        updated_at = excluded.updated_at
    `);

    for (const template of starterTemplates) {
      upsert.run(templateRecord(template, now));
    }
  });

  seed();
  logger.info({ count: starterTemplates.length }, 'database.templates.seeded');
  return { insertedOrUpdated: starterTemplates.length };
}

async function seedPostgresStarterTemplates(
  handle: PostgresDatabaseHandle,
  logger: Logger
): Promise<{ insertedOrUpdated: number }> {
  const client = await handle.pool.connect();
  const now = Date.now();

  try {
    await client.query('BEGIN');

    for (const template of starterTemplates) {
      const record = templateRecord(template, now);
      await client.query(
        `
          INSERT INTO templates (
            id, account_id, slug, name, description, type, content, slots,
            created_from_artifact, created_at, updated_at
          )
          VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, NULL, $8, $8)
          ON CONFLICT (slug) WHERE account_id IS NULL DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            type = excluded.type,
            content = excluded.content,
            slots = excluded.slots,
            updated_at = excluded.updated_at
        `,
        [
          record.id,
          record.slug,
          record.name,
          record.description,
          record.type,
          record.content,
          record.slots,
          record.now,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  logger.info({ count: starterTemplates.length }, 'database.templates.seeded');
  return { insertedOrUpdated: starterTemplates.length };
}

function templateRecord(template: StarterTemplate, now: number) {
  return {
    id: `tpl_${nanoid(21)}`,
    slug: template.slug,
    name: template.name,
    description: template.description,
    type: template.type,
    content: template.content,
    slots: JSON.stringify(template.slots),
    now,
  };
}
