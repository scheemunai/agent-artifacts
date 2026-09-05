import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { nanoid } from 'nanoid';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { z } from 'zod';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from '../db/client.js';
import { decodeSortCursor, encodeSortCursor } from '../lib/cursor.js';
import { AppError } from '../lib/errors.js';
import { resolveShippedPath } from '../lib/runtime-paths.js';
import {
  ARTIFACT_ID_PATTERN,
  type ArtifactType,
  artifactTypeSchema,
  slugSchema,
} from '../lib/schemas/artifacts.js';
import {
  DEFAULT_TEMPLATE_CATEGORY,
  promoteTemplateSchema,
  type TemplateCategory,
  templateCategorySchema,
  templateSlotSchema,
} from '../lib/schemas/templates.js';
import { validationFailed } from '../lib/validation.js';
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
  category: TemplateCategory;
  type: ArtifactType;
  thumbnail?: string | undefined;
  content: string;
  slots: TemplateSlot[];
}

export interface TemplateRow {
  id: string;
  account_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  category: string | null;
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
  category?: TemplateCategory;
}

export interface PromoteArtifactToTemplateInput {
  db: DatabaseHandle;
  accountId: string;
  artifactId: string;
  name: string;
  slug: string;
  description?: string | null;
  category?: TemplateCategory | undefined;
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
    category: templateCategorySchema,
    type: artifactTypeSchema,
    thumbnail: z.string().min(1).optional(),
    content_file: z.string().min(1),
    slots: z.array(templateSlotSchema).default([]),
  })
  .strict();
const starterManifestSchema = z
  .array(manifestEntrySchema)
  .min(5)
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (!seen.has(entry.slug)) {
        seen.add(entry.slug);
        continue;
      }
      ctx.addIssue({
        code: 'custom',
        path: [index, 'slug'],
        message: 'starter slugs must be unique',
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
    rootDir === undefined
      ? resolveStarterManifestPath()
      : resolve(rootDir, 'templates', 'manifest.ts');
  const templatesDir = dirname(manifestPath);
  const manifest = readManifest(manifestPath);

  return manifest.map((entry) => {
    const contentPath = resolveTemplateFile(templatesDir, entry.content_file);
    if (!existsSync(contentPath)) {
      // The RESOLVED path, not the manifest value. Three builders wrote `templates/<slug>.html`,
      // `templates/thumbs/…` and `templates/thumbnails/…` for `content_file`, each of which
      // resolves under `templates/` again and throws at seed time — and "not found:
      // templates/spec.html" reads like the file is missing rather than like the path is doubled.
      // Printing where it actually looked retires the whole class; documenting the convention only
      // helps whoever reads the documentation.
      throw new Error(
        `Starter template file not found for "${entry.slug}": content_file ${JSON.stringify(entry.content_file)} resolved to ${contentPath}. content_file is a BARE FILENAME relative to templates/ — "<slug>.html", no directory prefix.`
      );
    }

    const content = readFileSync(contentPath, 'utf8');
    if (entry.slots.length > 0) {
      assertNoInvalidTemplateResidue(content);
    }
    return {
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      type: entry.type,
      ...(entry.thumbnail !== undefined ? { thumbnail: entry.thumbnail } : {}),
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
  const rows = await listTemplateRows(
    input.db,
    input.accountId,
    input.options.limit + 1,
    cursor,
    input.options.category
  );
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

  const slots = parseSlots(template.slots);
  if (slots.length === 0) {
    // A zero-slot template copies verbatim and ignores `slots`. That is documented, and for a
    // template that has ALWAYS been zero-slot it is merely unhelpful. For one that took slots until
    // last week it is a trap: `changelog` was markdown with six required slots and is now a
    // zero-slot HTML document, so a saved workflow would keep getting 201 — and the demo release
    // notes instead of its own. A silent 201 with the wrong content is worse than any error,
    // because nothing anywhere reports it.
    const supplied = Object.keys(input.slots ?? {});
    if (supplied.length > 0 && FLIPPED_TEMPLATE_SLUGS.has(template.slug)) {
      throw new AppError(400, 'validation_failed', 'Template no longer takes slots', {
        template: template.slug,
        ignored_slots: supplied,
        valid_slots: [],
        template_changed: {
          slug: template.slug,
          now: `zero-slot ${template.type}`,
          what_to_do:
            'GET the template, rewrite its content in your own words, and publish it as type + content. Sending slots would have been ignored.',
        },
      });
    }
    return { template, content: template.content, type: template.type };
  }

  try {
    const content = mergeTemplateContent({
      content: template.content,
      slots,
      values: input.slots ?? {},
    });
    return { template, content, type: template.type };
  } catch (error) {
    const successor = retiredTemplateSuccessor(input.slug);
    if (successor && error instanceof AppError && error.code === 'validation_failed') {
      throw new AppError(400, 'validation_failed', 'Template slots are invalid', {
        ...(error.details as Record<string, unknown>),
        retired_template: { requested: input.slug, resolved_to: successor },
      });
    }
    throw error;
  }
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
    ...(input.category !== undefined ? { category: input.category } : {}),
  });
  if (!parsed.success) {
    throw validationFailed(parsed.error.issues);
  }

  const artifact = await resolveArtifactForPromotion(input.db, input.accountId, input.artifactId);
  if (!artifact || artifact.deleted_at !== null) {
    throw new AppError(404, 'not_found', 'Artifact not found');
  }

  const slotNames = extractSlotNames(artifact.content);
  if (slotNames.length > 0) {
    assertNoInvalidTemplateResidue(artifact.content);
  }

  // Checked here, in the position the database constraint used to occupy, so that the order errors
  // are reported in does not shift: an unknown artifact_id is still a 404 before it is a 409.
  await assertTemplateSlugAvailable(input.db, input.accountId, parsed.data.slug);

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
      thumbnailUrl: null,
      category: parsed.data.category ?? DEFAULT_TEMPLATE_CATEGORY,
      type: artifact.type,
      content: artifact.content,
      slots,
      createdFromArtifact: artifact.id,
      now,
    });
  } catch (error) {
    // The pre-flight check above is the one that produces a good message; this is the race backstop
    // and the only guard the built-in index can offer, so it stays.
    if (isUniqueConstraintError(error)) {
      throw new AppError(409, 'slug_conflict', 'Template slug is already in use', {
        field: 'slug',
        slug: parsed.data.slug,
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

/**
 * Built-in slugs are reserved, and the database cannot say so on its own: the unique indexes are
 * partial (`account_id IS NOT NULL` for account rows, `IS NULL` for built-ins), so nothing stopped
 * an account template from being created under the name of a built-in.
 *
 * What that bought was not a shadow you could see. `resolveTemplate` prefers the account row, so
 * `POST /v1/artifacts {"template":"report","slots":{…}}` kept answering 201 — but against the
 * shadow, which declares no slots, and a slot-free template is copied verbatim. The slots were
 * dropped in silence and the caller was handed somebody else's document with a success code on it.
 * The reservation is enforced here, at the only moment the ambiguity can be created.
 */
async function assertTemplateSlugAvailable(
  db: DatabaseHandle,
  accountId: string,
  slug: string
): Promise<void> {
  const existing = await resolveTemplateExact(db, accountId, slug);
  if (!existing) {
    return;
  }

  if (existing.account_id === null) {
    throw new AppError(
      409,
      'slug_conflict',
      `Template slug "${slug}" is reserved by a built-in template`,
      { field: 'slug', slug, built_in: true }
    );
  }

  throw new AppError(409, 'slug_conflict', 'Template slug is already in use', {
    field: 'slug',
    slug,
  });
}

export async function deleteTemplateResponse(input: {
  db: DatabaseHandle;
  accountId: string;
  slug: string;
}): Promise<Record<string, unknown>> {
  const template = await findAccountTemplateBySlug(input.db, input.accountId, input.slug);
  if (!template) {
    // A built-in under this slug is a different answer from "no such template": one says the caller
    // asked for something that is not theirs to delete, the other that it does not exist. Saying
    // 404 for both would send an agent hunting for a template it is looking straight at.
    const builtIn = await findBuiltInTemplateBySlug(input.db, input.slug);
    if (builtIn) {
      throw new AppError(403, 'built_in_template', 'Built-in templates cannot be deleted', {
        field: 'slug',
        slug: input.slug,
        built_in: true,
      });
    }
    throw new AppError(404, 'not_found', 'Template not found');
  }

  await execute(input.db, 'DELETE FROM templates WHERE id = ? AND account_id = ?', [
    template.id,
    input.accountId,
  ]);

  return { deleted: true, id: template.id, slug: template.slug };
}

export function parseSlots(slots: string): TemplateSlot[] {
  const parsed = JSON.parse(slots) as unknown;
  return Array.isArray(parsed) ? validateSlots(parsed) : [];
}

/**
 * The category a row is browsed under.
 *
 * Read rather than backfilled. A row can only be uncategorised if it was promoted before the column
 * existed, and putting somebody's old template into a category we guessed is a decision about their
 * content; defaulting on read is the same answer and stays wrong only until they set one.
 */
export function templateCategory(row: { category: string | null }): TemplateCategory {
  const parsed = templateCategorySchema.safeParse(row.category);
  return parsed.success ? parsed.data : DEFAULT_TEMPLATE_CATEGORY;
}

export function formatTemplate(row: TemplateRow, includeContent: boolean): Record<string, unknown> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    thumbnail_url: row.thumbnail_url,
    category: templateCategory(row),
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
        id, account_id, slug, name, description, thumbnail_url, category, type, content, slots,
        created_from_artifact, created_at, updated_at
      )
      VALUES (
        @id, NULL, @slug, @name, @description, @thumbnailUrl, @category, @type, @content, @slots,
        NULL, @now, @now
      )
      ON CONFLICT(slug) WHERE account_id IS NULL DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        thumbnail_url = excluded.thumbnail_url,
        category = excluded.category,
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
            id, account_id, slug, name, description, thumbnail_url, category, type, content, slots,
            created_from_artifact, created_at, updated_at
          )
          VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $10)
          ON CONFLICT (slug) WHERE account_id IS NULL DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            thumbnail_url = excluded.thumbnail_url,
            category = excluded.category,
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
          record.thumbnailUrl,
          record.category,
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
    thumbnailUrl: template.thumbnail ?? null,
    category: template.category,
    type: template.type,
    content: template.content,
    slots: JSON.stringify(template.slots),
    now,
  };
}

/**
 * One query for both populations, and that is the point of the feature.
 *
 * `account_id = ? OR account_id IS NULL` is the built-ins and this account's own templates in one
 * result — an agent browsing for a starting point should not have to ask twice and then merge, and
 * the category filter has to mean the same thing across both or filtering is a trap.
 *
 * The uncategorised case is carried in SQL rather than filtered in JS after paging, because
 * filtering a page after it has been cut is how a caller ends up with an empty page and a cursor
 * that still has rows behind it. A row promoted before the column existed reads as the default
 * category (`templateCategory`), so it must MATCH that category here too — the browse page and the
 * API cannot disagree about where somebody's old template lives.
 */
async function listTemplateRows(
  db: DatabaseHandle,
  accountId: string,
  limit: number,
  cursor: { u: number; id: string } | null,
  category?: TemplateCategory
): Promise<TemplateRow[]> {
  const params: unknown[] = [accountId];
  let categoryClause = '';
  if (category) {
    categoryClause =
      category === DEFAULT_TEMPLATE_CATEGORY
        ? 'AND (category = ? OR category IS NULL)'
        : 'AND category = ?';
    params.push(category);
  }
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
      WHERE (account_id = ? OR account_id IS NULL) ${categoryClause} ${cursorClause}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `,
    params
  );
}

/**
 * Account row first, built-in second.
 *
 * That precedence is deliberate and stays. Flipping it to "built-in always wins" would look like
 * the tidier invariant, but it would mean shipping a new starter template could silently
 * repossess a name an account was already using — the account's own document would quietly turn
 * into ours. Collisions are prevented at creation time by `assertTemplateSlugAvailable` instead,
 * which is the only place where nobody is depending on the answer yet. Rows that predate that
 * check keep resolving to the account's template until the owner deletes it.
 */
/**
 * Slugs of retired built-ins, and what they now resolve to.
 *
 * A SLUG IS AN API. Published artifacts are copies and are unaffected by a template retirement, but
 * an agent with `template: "recap"` written into a saved workflow would start receiving a 400 for a
 * template that used to exist — and that failure is invisible to us, because the agent is the only
 * one who ever sees it. So the CONTENT retires and the NAME does not: `recap.html` violated the
 * quality contract four ways and `meeting-recap` supersedes it properly, but `recap` keeps
 * answering.
 *
 * Deliberately a one-way map to a surviving slug rather than a table of tombstones: there is no
 * behaviour here to get wrong, and the response carries the canonical `slug`, so an agent that
 * looks at what it got back can see the template moved.
 */
const RETIRED_TEMPLATE_SLUGS: Readonly<Record<string, string>> = {
  recap: 'meeting-recap',
  briefing: 'report',
};

/**
 * An alias is only fully transparent for a ZERO-SLOT template, and that asymmetry is worth naming
 * because it decides what this map can and cannot promise.
 *
 * `recap` was zero-slot HTML and `meeting-recap` is too, so a saved `template: "recap"` keeps
 * publishing byte-for-byte as before — nothing to notice. `briefing` took four required slots
 * (`title`, `date`, `tldr`, `sections`) and its closest survivor `report` takes five different ones,
 * so the same call now fails on slots instead of on the template name. That failure is honest — the
 * template really did change — but a bare "unknown slot: tldr" reads like the agent's own typo. So
 * the retirement is named in the error, turning a mystery into an instruction.
 */
export function retiredTemplateSuccessor(slug: string): string | null {
  return RETIRED_TEMPLATE_SLUGS[slug] ?? null;
}

/**
 * The exact-name lookup, with no alias following.
 *
 * Split out from `resolveTemplate` because the two answer different questions and only one of them
 * wants aliases. "What should I render for this request?" should follow a retirement. "Is this
 * exact name taken?" must not — routing reservation through the alias made
 * `POST /v1/templates {slug: "recap"}` answer *"recap is reserved by a built-in template"*, naming
 * a reservation that no longer exists, because the lookup wandered off to `meeting-recap` and
 * reported what it found there. One resolver serving two questions is how that happens.
 */
/**
 * Built-ins that USED to take slots and no longer do.
 *
 * Kept as an explicit list rather than applied to every zero-slot template, because the two cases
 * are genuinely different. A template that has always been zero-slot has never accepted slots from
 * anyone, so rejecting them now would break callers to teach them something the contract already
 * says. A template that took slots yesterday has live callers who will otherwise be handed a demo
 * document with a 201 on it. Add a slug here in the same change that flips it; `report` joins when
 * its HTML replacement lands.
 */
const FLIPPED_TEMPLATE_SLUGS = new Set(['changelog']);

async function resolveTemplateExact(
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

async function resolveTemplate(
  db: DatabaseHandle,
  accountId: string,
  slug: string
): Promise<TemplateRow | null> {
  const exact = await resolveTemplateExact(db, accountId, slug);
  if (exact) {
    return exact;
  }

  // Only after an exact miss, so an account that has since made its OWN template called `recap`
  // keeps it. Their template is the more specific answer to their request, and an alias that
  // shadowed it would be a worse bug than the one this map exists to prevent.
  const aliased = RETIRED_TEMPLATE_SLUGS[slug];
  return aliased ? resolveTemplate(db, accountId, aliased) : null;
}

async function findAccountTemplateBySlug(
  db: DatabaseHandle,
  accountId: string,
  slug: string
): Promise<TemplateRow | null> {
  return queryOne<TemplateRow>(
    db,
    'SELECT * FROM templates WHERE slug = ? AND account_id = ? LIMIT 1',
    [slug, accountId]
  );
}

async function findBuiltInTemplateBySlug(
  db: DatabaseHandle,
  slug: string
): Promise<TemplateRow | null> {
  return queryOne<TemplateRow>(
    db,
    'SELECT * FROM templates WHERE slug = ? AND account_id IS NULL LIMIT 1',
    [slug]
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
    thumbnailUrl: string | null;
    category: TemplateCategory;
    type: ArtifactType;
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
        id, account_id, slug, name, description, thumbnail_url, category, type, content, slots,
        created_from_artifact, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.id,
      input.accountId,
      input.slug,
      input.name,
      input.description,
      input.thumbnailUrl,
      input.category,
      input.type,
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
