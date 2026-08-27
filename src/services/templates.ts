import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { nanoid } from 'nanoid';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { z } from 'zod';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from '../db/client.js';
import { decodeSortCursor, encodeSortCursor } from '../lib/cursor.js';
import { AppError } from '../lib/errors.js';
import { ARTIFACT_ID_PATTERN, type ArtifactType, slugSchema } from '../lib/schemas/artifacts.js';
import { promoteTemplateSchema, templateSlotSchema } from '../lib/schemas/templates.js';
import { resolveShippedPath } from '../lib/runtime-paths.js';
import type { Logger } from '../logger.js';

export interface TemplateSlot {
  name: string;
  description: string;
  required: boolean;
}

export interface StarterTemplate {
  slug: string;
  name: string;
  description: string;
  type: 'markdown';
  content: string;
  slots: TemplateSlot[];
}

export interface TemplateRow {
  id: string;
  account_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  type: ArtifactType;
  content: string;
  slots: string;
  created_from_artifact: string | null;
  created_at: number;
  updated_at: number;
}

export interface TemplateMergeResult {
  template: TemplateRow;
  content: string;
  type: ArtifactType;
}

export interface ListTemplatesOptions {
  limit: number;
  cursor?: string;
}

export interface PromoteArtifactToTemplateInput {
  db: DatabaseHandle;
  accountId: string;
  artifactId: string;
  name: string;
  slug: string;
  description?: string | null;
}

interface ArtifactForPromotion {
  id: string;
  account_id: string;
  slug: string;
  type: ArtifactType;
  content: string;
  deleted_at: number | null;
}

const slotTokenPattern = /\{\{([a-z0-9_]{1,40})\}\}/g;
const escapedOpenPattern = /\\\{\\\{/g;
const manifestEntrySchema = z
  .object({
    slug: slugSchema,
    name: z.string().min(1).max(80),
    description: z.string().max(300),
    type: z.literal('markdown'),
    content_file: z.string().min(1),
    slots: z.array(templateSlotSchema).min(1),
  })
  .strict();
const starterManifestSchema = z
  .array(manifestEntrySchema)
  .length(5)
  .superRefine((entries, ctx) => {
    const slugs = entries.map((entry) => entry.slug).toSorted();
    const expected = ['briefing', 'changelog', 'dashboard', 'one-pager', 'report'];
    if (slugs.join(',') !== expected.join(',')) {
      ctx.addIssue({
        code: 'custom',
        message: `starter slugs must be ${expected.join(', ')}`,
      });
    }
  });
type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/**
 * @param rootDir Directory containing `templates/`. Omit it in production: the manifest is then
 * resolved from the installation rather than from the working directory, so seeding survives a
 * process started anywhere (it used to throw ENOENT on `<cwd>/templates/manifest.ts`).
 */
export function loadStarterTemplates(rootDir?: string): StarterTemplate[] {
  const manifestPath =
    rootDir === undefined ? resolveStarterManifestPath() : resolve(rootDir, 'templates', 'manifest.ts');
  const templatesDir = dirname(manifestPath);
  const manifest = readManifest(manifestPath);

  return manifest.map((entry) => {
    const contentPath = resolveTemplateFile(templatesDir, entry.content_file);
    if (!existsSync(contentPath)) {
      throw new Error(`Starter template file not found: ${entry.content_file}`);
    }

    const content = readFileSync(contentPath, 'utf8');
    assertNoInvalidTemplateResidue(content);
    return {
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      type: entry.type,
      content,
      slots: entry.slots,
    };
  });
}

export async function seedStarterTemplates(
  handle: DatabaseHandle,
  logger: Logger
): Promise<{ insertedOrUpdated: number }> {
  const starterTemplates = loadStarterTemplates();

  if (handle.dialect === 'sqlite') {
    return seedSqliteStarterTemplates(handle, logger, starterTemplates);
  }

  return seedPostgresStarterTemplates(handle, logger, starterTemplates);
}

export async function listTemplatesResponse(input: {
  db: DatabaseHandle;
  accountId: string;
  options: ListTemplatesOptions;
}): Promise<Record<string, unknown>> {
  const cursor = decodeSortCursor(input.options.cursor);
  const rows = await listTemplateRows(input.db, input.accountId, input.options.limit + 1, cursor);
  const pageRows = rows.slice(0, input.options.limit);
  return {
    items: pageRows.map((row) => formatTemplate(row, false)),
    next_cursor:
      rows.length > input.options.limit
        ? encodeSortCursor({
            u: pageRows.at(-1)?.updated_at ?? 0,
            id: pageRows.at(-1)?.id ?? '',
          })
        : null,
  };
}

export async function getTemplateResponse(input: {
  db: DatabaseHandle;
  accountId: string;
  slug: string;
}): Promise<Record<string, unknown>> {
  const template = await resolveTemplate(input.db, input.accountId, input.slug);
  if (!template) {
    throw new AppError(404, 'not_found', 'Template not found');
  }

  return formatTemplate(template, true);
}

export async function mergeTemplate(input: {
  db: DatabaseHandle;
  accountId: string;
  slug: string;
  slots?: Record<string, string>;
}): Promise<TemplateMergeResult> {
  const template = await resolveTemplate(input.db, input.accountId, input.slug);
  if (!template) {
    throw new AppError(400, 'validation_failed', 'Unknown template', {
      unknown_template: input.slug,
    });
  }

  if (template.type !== 'markdown') {
    throw new AppError(400, 'validation_failed', 'Only markdown templates are supported in v1', {
      field: 'template',
      reason: 'template_type_not_supported',
    });
  }

  const content = mergeTemplateContent({
    content: template.content,
    slots: parseSlots(template.slots),
    values: input.slots ?? {},
  });
  return { template, content, type: template.type };
}

export function mergeTemplateContent(input: {
  content: string;
  slots: TemplateSlot[];
  values?: Record<string, string>;
}): string {
  assertNoInvalidTemplateResidue(input.content);

  const slots = validateSlots(input.slots);
  const values = input.values ?? {};
  const validSlots = slots.map((slot) => slot.name);
  const validSlotSet = new Set(validSlots);
  const missingSlots = slots
    .filter((slot) => slot.required && values[slot.name] === undefined)
    .map((slot) => slot.name);
  const unknownValueSlots = Object.keys(values).filter((slot) => !validSlotSet.has(slot));
  const undeclaredTemplateSlots = extractSlotNames(input.content).filter(
    (slot) => !validSlotSet.has(slot)
  );
  const unknownSlots = Array.from(new Set([...unknownValueSlots, ...undeclaredTemplateSlots]));

  if (missingSlots.length > 0 || unknownSlots.length > 0) {
    throw new AppError(400, 'validation_failed', 'Template slots are invalid', {
      ...(missingSlots.length > 0 ? { missing_slots: missingSlots } : {}),
      ...(unknownSlots.length > 0 ? { unknown_slots: unknownSlots } : {}),
      valid_slots: validSlots,
    });
  }

  let content = '';
  let lastIndex = 0;
  slotTokenPattern.lastIndex = 0;
  for (const match of input.content.matchAll(slotTokenPattern)) {
    const start = match.index ?? 0;
    const name = match[1] ?? '';
    content += unescapeTemplateText(input.content.slice(lastIndex, start));
    content += values[name] ?? '';
    lastIndex = start + match[0].length;
  }
  content += unescapeTemplateText(input.content.slice(lastIndex));

  return content;
}

export async function promoteArtifactToTemplate(
  input: PromoteArtifactToTemplateInput
): Promise<TemplateRow> {
  const parsed = promoteTemplateSchema.safeParse({
    artifact_id: input.artifactId,
    name: input.name,
    slug: input.slug,
    ...(input.description !== undefined && input.description !== null
      ? { description: input.description }
      : {}),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError(400, 'validation_failed', issue?.message ?? 'Validation failed', {
      ...(issue?.path[0] ? { field: String(issue.path[0]) } : {}),
      issues: parsed.error.issues.map((item) => ({
        field: item.path.join('.'),
        message: item.message,
      })),
    });
  }

  const artifact = await resolveArtifactForPromotion(input.db, input.accountId, input.artifactId);
  if (!artifact || artifact.deleted_at !== null) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }
  if (artifact.type !== 'markdown') {
    throw new AppError(400, 'validation_failed', 'Only markdown artifacts can be promoted', {
      field: 'type',
      reason: 'html_not_supported',
    });
  }

  assertNoInvalidTemplateResidue(artifact.content);
  const slotNames = extractSlotNames(artifact.content);
  if (slotNames.length === 0) {
    throw new AppError(400, 'validation_failed', 'Add at least one {{slot}} placeholder first', {
      field: 'content',
      reason: 'no_slots',
    });
  }

  const now = Date.now();
  const templateId = `tpl_${nanoid(21)}`;
  const slots = slotNames.map((name) => ({
    name,
    description: `Slot ${name}`,
    required: true,
  }));

  try {
    await insertAccountTemplate(input.db, {
      id: templateId,
      accountId: input.accountId,
      slug: parsed.data.slug,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      content: artifact.content,
      slots,
      createdFromArtifact: artifact.id,
      now,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'slug_conflict', 'Template slug is already in use', {
        field: 'slug',
      });
    }
    throw error;
  }

  const template = await findTemplateById(input.db, templateId);
  if (!template) {
    throw new AppError(500, 'internal_error', 'Template was not persisted');
  }
  return template;
}

export async function promoteTemplateResponse(
  input: PromoteArtifactToTemplateInput
): Promise<Record<string, unknown>> {
  return formatTemplate(await promoteArtifactToTemplate(input), true);
}

export function parseSlots(slots: string): TemplateSlot[] {
  const parsed = JSON.parse(slots) as unknown;
  return Array.isArray(parsed) ? validateSlots(parsed) : [];
}

export function formatTemplate(row: TemplateRow, includeContent: boolean): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: row.type,
    built_in: row.account_id === null,
    ...(includeContent
      ? { content: row.content }
      : { content_length: Buffer.byteLength(row.content, 'utf8') }),
    slots: parseSlots(row.slots),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

export function resolveStarterManifestPath(): string {
  return resolveShippedPath({
    what: 'starter template manifest',
    relative: 'templates/manifest.ts',
    fix: 'the installation must ship templates/ next to dist/ (the Docker image copies it); from a source checkout, start the app from the repository root',
  });
}

function readManifest(manifestPath: string): ManifestEntry[] {
  const source = readFileSync(manifestPath, 'utf8');
  const match = /export const starterTemplateManifest\s*=\s*(\[[\s\S]*?\])\s*as const;?/.exec(
    source
  );
  if (!match?.[1]) {
    throw new Error('templates/manifest.ts must export starterTemplateManifest as a const array');
  }

  const parsed = JSON.parse(match[1]) as unknown;
  return starterManifestSchema.parse(parsed);
}

function resolveTemplateFile(templatesDir: string, contentFile: string): string {
  const resolved = resolve(templatesDir, contentFile);
  const normalizedDir = templatesDir.endsWith(sep) ? templatesDir : `${templatesDir}${sep}`;
  if (!resolved.startsWith(normalizedDir)) {
    throw new Error(`Starter template file must stay inside templates/: ${contentFile}`);
  }
  return resolved;
}

function validateSlots(value: unknown[]): TemplateSlot[] {
  return value.map((slot) => {
    const parsed = templateSlotSchema.parse(slot);
    return {
      name: parsed.name,
      description: parsed.description,
      required: parsed.required,
    };
  });
}

function extractSlotNames(content: string): string[] {
  const names: string[] = [];
  slotTokenPattern.lastIndex = 0;
  for (const match of content.matchAll(slotTokenPattern)) {
    const name = match[1] ?? '';
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

function assertNoInvalidTemplateResidue(content: string): void {
  const templateTextOnly = content
    .replace(escapedOpenPattern, '')
    .replace(/\{\{[a-z0-9_]{1,40}\}\}/g, '');
  const residue = /\{\{[^}]*\}\}/.exec(templateTextOnly);
  if (residue) {
    throw new AppError(400, 'validation_failed', 'Template contains an invalid slot marker', {
      field: 'template',
      reason: 'invalid_slot_marker',
    });
  }
}

function unescapeTemplateText(text: string): string {
  return text.replace(escapedOpenPattern, '{{');
}

function seedSqliteStarterTemplates(
  handle: SqliteDatabaseHandle,
  logger: Logger,
  starterTemplates: StarterTemplate[]
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
  logger: Logger,
  starterTemplates: StarterTemplate[]
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

async function listTemplateRows(
  db: DatabaseHandle,
  accountId: string,
  limit: number,
  cursor: { u: number; id: string } | null
): Promise<TemplateRow[]> {
  const params: unknown[] = [accountId];
  const cursorClause = cursor ? 'AND (updated_at < ? OR (updated_at = ? AND id < ?))' : '';
  if (cursor) {
    params.push(cursor.u, cursor.u, cursor.id);
  }
  params.push(limit);
  return queryAll<TemplateRow>(
    db,
    `
      SELECT *
      FROM templates
      WHERE (account_id = ? OR account_id IS NULL) ${cursorClause}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `,
    params
  );
}

async function resolveTemplate(
  db: DatabaseHandle,
  accountId: string,
  slug: string
): Promise<TemplateRow | null> {
  return queryOne<TemplateRow>(
    db,
    `
      SELECT *
      FROM templates
      WHERE slug = ? AND (account_id = ? OR account_id IS NULL)
      ORDER BY account_id IS NOT NULL DESC
      LIMIT 1
    `,
    [slug, accountId]
  );
}

async function resolveArtifactForPromotion(
  db: DatabaseHandle,
  accountId: string,
  artifactIdOrSlug: string
): Promise<ArtifactForPromotion | null> {
  const byId = ARTIFACT_ID_PATTERN.test(artifactIdOrSlug);
  return queryOne<ArtifactForPromotion>(
    db,
    `
      SELECT id, account_id, slug, type, content, deleted_at
      FROM artifacts
      WHERE account_id = ? AND ${byId ? 'id' : 'slug'} = ? AND deleted_at IS NULL
      LIMIT 1
    `,
    [accountId, artifactIdOrSlug]
  );
}

async function insertAccountTemplate(
  db: DatabaseHandle,
  input: {
    id: string;
    accountId: string;
    slug: string;
    name: string;
    description: string | null;
    content: string;
    slots: TemplateSlot[];
    createdFromArtifact: string;
    now: number;
  }
): Promise<void> {
  await execute(
    db,
    `
      INSERT INTO templates (
        id, account_id, slug, name, description, type, content, slots,
        created_from_artifact, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.accountId,
      input.slug,
      input.name,
      input.description,
      input.content,
      JSON.stringify(input.slots),
      input.createdFromArtifact,
      input.now,
      input.now,
    ]
  );
}

async function findTemplateById(
  db: DatabaseHandle,
  templateId: string
): Promise<TemplateRow | null> {
  return queryOne<TemplateRow>(db, 'SELECT * FROM templates WHERE id = ?', [templateId]);
}

async function queryOne<T extends QueryResultRow>(
  db: DatabaseHandle,
  sql: string,
  params: unknown[]
): Promise<T | null> {
  if (db.dialect === 'sqlite') {
    return (db.sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  const result = await pgQuery<T>(db.pool, sql, params);
  return result.rows[0] ?? null;
}

async function queryAll<T extends QueryResultRow>(
  db: DatabaseHandle,
  sql: string,
  params: unknown[]
): Promise<T[]> {
  if (db.dialect === 'sqlite') {
    return db.sqlite.prepare(sql).all(...params) as T[];
  }

  const result = await pgQuery<T>(db.pool, sql, params);
  return result.rows;
}

async function execute(db: DatabaseHandle, sql: string, params: unknown[]): Promise<number> {
  if (db.dialect === 'sqlite') {
    return Number(db.sqlite.prepare(sql).run(...params).changes);
  }

  const result = await pgQuery(db.pool, sql, params);
  return result.rowCount ?? 0;
}

async function pgQuery<T extends QueryResultRow>(
  executor: PostgresDatabaseHandle['pool'] | PoolClient,
  sql: string,
  params: unknown[]
): Promise<QueryResult<T>> {
  let index = 0;
  const text = sql.replace(/\?/g, () => `$${++index}`);
  return executor.query<T>(text, params);
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'code' in error ? String(error.code) : '';
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505';
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}
