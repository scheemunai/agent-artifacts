import { z } from 'zod';

export const ARTIFACT_TYPES = ['markdown', 'html'] as const;
export const ARTIFACT_ID_PATTERN = /^art_[A-Za-z0-9_-]{21}$/;
export const BOT_ID_PATTERN = /^bot_[A-Za-z0-9_-]{21}$/;
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const TEMPLATE_ID_PATTERN = /^tpl_[A-Za-z0-9_-]{21}$/;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BOT_KEY_PATTERN = /^aa_bot_[A-Za-z0-9_-]{32}$/;

export const MAX_CONTENT_BYTES = 2_097_152;
export const JSON_BODY_OVERHEAD_BYTES = 512 * 1024;
export const MAX_JSON_BODY_BYTES = MAX_CONTENT_BYTES + JSON_BODY_OVERHEAD_BYTES;
export const MAX_TITLE_CHARS = 255;
export const MAX_SLUG_CHARS = 80;
export const MAX_CHANGE_SUMMARY_CHARS = 2_000;
export const MAX_METADATA_BYTES = 8 * 1024;
export const MAX_PASSWORD_CHARS = 128;
export const MIN_PASSWORD_CHARS = 4;
export const MAX_QUERY_CHARS = 80;

export const artifactTypeSchema = z.enum(ARTIFACT_TYPES);
export const slugSchema = z
  .string()
  .min(1)
  .max(MAX_SLUG_CHARS)
  .regex(SLUG_PATTERN, 'must contain lowercase letters, numbers, and single dashes only');
export const titleSchema = z.string().min(1).max(MAX_TITLE_CHARS);
export const contentSchema = z.string();
export const changeSummarySchema = z.string().max(MAX_CHANGE_SUMMARY_CHARS);
export const metadataSchema = z.record(z.string(), z.unknown());
export const passwordSchema = z.string().min(MIN_PASSWORD_CHARS).max(MAX_PASSWORD_CHARS);
export const limitSchema = z.preprocess(
  (value) => (value === undefined || value === '' ? 20 : value),
  z.coerce
    .number()
    .int()
    .min(1)
    .transform((value) => Math.min(value, 100))
);

export const publishArtifactSchema = z
  .object({
    slug: slugSchema.optional(),
    type: artifactTypeSchema.optional(),
    title: titleSchema,
    content: contentSchema.optional(),
    template: slugSchema.optional(),
    slots: z.record(z.string(), z.string()).optional(),
    metadata: metadataSchema.optional(),
    change_summary: changeSummarySchema.optional(),
    share: z.boolean().optional(),
    password: passwordSchema.optional(),
  })
  .strict();

export const updateArtifactSchema = z
  .object({
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    type: artifactTypeSchema.optional(),
    slug: slugSchema.optional(),
    metadata: metadataSchema.optional(),
    change_summary: changeSummarySchema.optional(),
  })
  .strict();

export const restoreVersionSchema = z
  .object({
    change_summary: changeSummarySchema.optional(),
  })
  .strict();

export const createShareSchema = z
  .object({
    password: passwordSchema.optional(),
  })
  .strict();

export const patchShareSchema = z
  .object({
    password: passwordSchema.nullable(),
  })
  .strict();

export const artifactListQuerySchema = z.object({
  bot: z.string().regex(BOT_ID_PATTERN).optional(),
  type: artifactTypeSchema.optional(),
  updated_since: z.union([z.string(), z.coerce.number().int()]).optional(),
  q: z.string().max(MAX_QUERY_CHARS).optional(),
  limit: limitSchema,
  cursor: z.string().optional(),
});

export const versionListQuerySchema = z.object({
  limit: limitSchema,
  cursor: z.string().optional(),
});

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type PublishArtifactInput = z.infer<typeof publishArtifactSchema>;
export type UpdateArtifactInput = z.infer<typeof updateArtifactSchema>;
