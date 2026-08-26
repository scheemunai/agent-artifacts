import { z } from 'zod';
import { artifactTypeSchema, limitSchema, slugSchema } from './artifacts.js';

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

export type TemplateSlot = z.infer<typeof templateSlotSchema>;
