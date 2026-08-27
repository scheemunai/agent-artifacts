import { z } from 'zod';
import { ARTIFACT_ID_PATTERN, artifactTypeSchema, limitSchema, slugSchema } from './artifacts.js';

export const templateSlotSchema = z.object({
  name: z.string().regex(/^[a-z0-9_]{1,40}$/),
  description: z.string(),
  required: z.boolean(),
});

export const templateListQuerySchema = z.object({
  limit: limitSchema,
  cursor: z.string().optional(),
});

export const templateObjectSchema = z.object({
  id: z.string(),
  slug: slugSchema,
  name: z.string(),
  description: z.string().nullable(),
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
  })
  .strict();

export type TemplateSlot = z.infer<typeof templateSlotSchema>;
export type PromoteTemplateInput = z.infer<typeof promoteTemplateSchema>;
