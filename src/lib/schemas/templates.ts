import { z } from 'zod';
import { ARTIFACT_ID_PATTERN, artifactTypeSchema, limitSchema, slugSchema } from './artifacts.js';

export const templateSlotSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{1,40}$/),
  description: z.string(),
  required: z.boolean(),
});

/**
 * The job a template does, as a value an agent can filter on.
 *
 * A closed set rather than a free string, and deliberately so: this is the axis the public browse
 * page groups by and the axis an agent narrows by, so a typo would silently produce an empty
 * category on a marketing page and an empty result for a caller who did everything right. Adding a
 * category is a code change with a page section behind it, which is the right amount of friction.
 *
 * Ordered as the browse page reads, not alphabetically — the order is part of the answer.
 */
export const TEMPLATE_CATEGORIES = [
  'meetings',
  'decisions',
  'research',
  'status',
  'releases',
  'plans',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const templateCategorySchema = z.enum(TEMPLATE_CATEGORIES);

/**
 * What a template with no category told us before it had one.
 *
 * Every built-in declares its category in the manifest, so this is only ever reached by an account
 * template promoted before the field existed, or by one promoted without naming a category. It is a
 * real category rather than a null, because a template that cannot be browsed to is a template
 * nobody finds.
 */
export const DEFAULT_TEMPLATE_CATEGORY: TemplateCategory = 'research';

export const templateListQuerySchema = z.object({
  limit: limitSchema,
  cursor: z.string().optional(),
  category: templateCategorySchema.optional(),
});

export const templateObjectSchema = z.object({
  id: z.string(),
  slug: slugSchema,
  name: z.string(),
  description: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  category: templateCategorySchema,
  type: artifactTypeSchema,
  built_in: z.boolean(),
  content: z.string().optional(),
  content_length: z.number().int().optional(),
  slots: z.array(templateSlotSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

export const promoteTemplateSchema = z
  .object({
    artifact_id: z.string().regex(ARTIFACT_ID_PATTERN),
    slug: slugSchema,
    name: z.string().min(1).max(80),
    description: z.string().max(300).optional(),
    category: templateCategorySchema.optional(),
  })
  .strict();

export type TemplateSlot = z.infer<typeof templateSlotSchema>;
export type PromoteTemplateInput = z.infer<typeof promoteTemplateSchema>;
