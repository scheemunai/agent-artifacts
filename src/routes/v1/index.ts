import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import { Hono as HonoApp } from 'hono';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { DatabaseHandle } from '../../db/client.js';
import type { CloudModule } from '../../extension/cloud-module.js';
import { AppError } from '../../lib/errors.js';
import { clientIp, enforceRateLimit, globalRateLimitStore } from '../../lib/rate-limit.js';
import {
  artifactListQuerySchema,
  createShareSchema,
  patchShareSchema,
  promoteTemplateSchema,
  publishArtifactSchema,
  restoreVersionSchema,
  templateListQuerySchema,
  updateArtifactSchema,
  versionListQuerySchema,
} from '../../lib/schemas/index.js';
import type { Logger } from '../../logger.js';
import {
  getTemplateResponse,
  listTemplatesResponse,
  mergeTemplate,
  promoteTemplateResponse,
} from '../../services/templates.js';
import {
  type AuthPrincipal,
  authenticateBotToken,
  bearerToken,
  createPasswordHash,
  createShareResponse,
  deleteArtifact,
  deleteShareResponse,
  deriveSlug,
  downloadArtifact,
  ensureContentLimit,
  ensureMetadataLimit,
  getArtifactResponse,
  getVersionResponse,
  listArtifactsResponse,
  listVersionsResponse,
  parsePositiveVersion,
  parseUpdatedSince,
  patchShareResponse,
  publishArtifact,
  restoreArtifactVersion,
  updateArtifact,
} from '../../services/v1.js';

export interface V1RoutesContext {
  config: AppConfig;
  logger: Logger;
  db?: DatabaseHandle;
  cloudModule?: CloudModule;
}

interface V1Variables {
  auth: AuthPrincipal;
}

type V1Env = { Variables: V1Variables };

export function registerV1Routes<E extends Env>(app: Hono<E>, ctx: V1RoutesContext): void {
  const v1 = new HonoApp<V1Env>();

  const unauthRateLimit: MiddlewareHandler = async (context, next) => {
    if (!ctx.config.rateLimitsDisabled) {
      enforceRateLimit(
        context,
        globalRateLimitStore,
        `v1:ip:${clientIp(context, ctx.config.trustProxy)}`,
        ctx.config.rateLimitRpm,
        60_000
      );
    }
    await next();
  };

  app.get('/llms.txt', unauthRateLimit, (context) => contractResponse(context, ctx.config));
  app.all('/llms.txt', (context) => {
    context.header('Allow', 'GET');
    throw new AppError(405, 'method_not_allowed', 'Method not allowed');
  });
  v1.get('/contract', unauthRateLimit, (context) => contractResponse(context, ctx.config));
  v1.get('/openapi.json', unauthRateLimit, (context) => {
    context.header('Cache-Control', 'public, max-age=3600');
    return context.json(openApiDocument(ctx.config));
  });

  v1.use('/artifacts', authMiddleware(ctx));
  v1.use('/artifacts/*', authMiddleware(ctx));
  v1.use('/templates', authMiddleware(ctx));
  v1.use('/templates/*', authMiddleware(ctx));

  v1.get('/artifacts', async (context) => {
    const auth = requireAuth(context);
    const db = requireDb(ctx);
    const query = parseQuery(context, artifactListQuerySchema);
    const updatedSince = parseUpdatedSince(query.updated_since);
    return context.json(
      await listArtifactsResponse({
        db,
        cloudModule: requireCloudModule(ctx),
        config: ctx.config,
        account: auth.account,
        options: {
          limit: query.limit,
          ...(query.bot ? { bot: query.bot } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(query.q ? { q: query.q } : {}),
          ...(updatedSince !== undefined ? { updatedSince } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
      })
    );
  });

  v1.post('/artifacts', async (context) => {
    const auth = requireAuth(context);
    const db = requireDb(ctx);
    const body = parseBody(
      await readJson(context, ctx.config.jsonBodyLimitBytes),
      publishArtifactSchema
    );
    ensureMetadataLimit(body.metadata);

    if (body.template && (body.content !== undefined || body.type !== undefined)) {
      throw new AppError(
        400,
        'validation_failed',
        'template cannot be combined with type or content',
        {
          field: 'template',
        }
      );
    }

    const slug = body.slug ?? deriveSlug(body.title);
    if (!slug) {
      throw new AppError(400, 'validation_failed', 'Could not derive slug from title', {
        field: 'slug',
        reason: 'cannot derive slug from title; provide slug',
      });
    }

    let type = body.type;
    let content = body.content;
    if (body.template) {
      const merged = await mergeTemplate({
        db,
        accountId: auth.account.id,
        slug: body.template,
        ...(body.slots !== undefined ? { slots: body.slots } : {}),
      });
      type = merged.type;
      content = merged.content;
    }

    if (!type) {
      throw new AppError(400, 'validation_failed', 'type is required without template', {
        field: 'type',
      });
    }
    if (content === undefined) {
      throw new AppError(400, 'validation_failed', 'content is required without template', {
        field: 'content',
      });
    }
    ensureContentLimit(content, ctx.config.maxContentBytes);

    const passwordHash = body.password ? await createPasswordHash(body.password) : undefined;
    const result = await publishArtifact({
      db,
      cloudModule: requireCloudModule(ctx),
      config: ctx.config,
      auth,
      slug,
      type,
      title: body.title,
      content,
      share: body.share === true || Boolean(body.password),
      ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
      ...(body.change_summary !== undefined ? { changeSummary: body.change_summary } : {}),
      ...(passwordHash !== undefined ? { passwordHash } : {}),
      ...(body.template !== undefined ? { templateSlug: body.template } : {}),
    });
    return context.json(result.body, result.status);
  });

  v1.post('/artifacts/:id_or_slug/versions/:n/restore', async (context) => {
    const auth = requireAuth(context);
    const body = parseBody(
      await readJson(context, ctx.config.jsonBodyLimitBytes),
      restoreVersionSchema
    );
    const versionNum = parsePositiveVersion(context.req.param('n'));
    const response = await restoreArtifactVersion({
      db: requireDb(ctx),
      cloudModule: requireCloudModule(ctx),
      config: ctx.config,
      auth,
      idOrSlug: context.req.param('id_or_slug'),
      versionNum,
      ...(body.change_summary !== undefined ? { changeSummary: body.change_summary } : {}),
    });
    return context.json(response, 201);
  });

  v1.get('/artifacts/:id_or_slug/versions/:n', async (context) => {
    const auth = requireAuth(context);
    const versionNum = parsePositiveVersion(context.req.param('n'));
    const response = await getVersionResponse({
      db: requireDb(ctx),
      accountId: auth.account.id,
      idOrSlug: context.req.param('id_or_slug'),
      versionNum,
    });
    context.header('Cache-Control', 'private, max-age=86400, immutable');
    return context.json(response);
  });

  v1.get('/artifacts/:id_or_slug/versions', async (context) => {
    const auth = requireAuth(context);
    const query = parseQuery(context, versionListQuerySchema);
    return context.json(
      await listVersionsResponse({
        db: requireDb(ctx),
        accountId: auth.account.id,
        idOrSlug: context.req.param('id_or_slug'),
        options: {
          limit: query.limit,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
      })
    );
  });

  v1.get('/artifacts/:id_or_slug/download', async (context) => {
    const auth = requireAuth(context);
    const download = await downloadArtifact({
      db: requireDb(ctx),
      accountId: auth.account.id,
      idOrSlug: context.req.param('id_or_slug'),
    });
    context.header('Content-Type', download.contentType);
    context.header('Content-Disposition', `attachment; filename="${download.filename}"`);
    return context.body(download.body);
  });

  v1.post('/artifacts/:id_or_slug/share', async (context) => {
    const auth = requireAuth(context);
    const body = parseBody(
      await readJson(context, ctx.config.jsonBodyLimitBytes, true),
      createShareSchema
    );
    const passwordHash = body.password ? await createPasswordHash(body.password) : undefined;
    const response = await createShareResponse({
      db: requireDb(ctx),
      cloudModule: requireCloudModule(ctx),
      config: ctx.config,
      auth,
      idOrSlug: context.req.param('id_or_slug'),
      ...(passwordHash !== undefined ? { passwordHash } : {}),
    });
    return context.json(response.body, response.status);
  });

  v1.patch('/artifacts/:id_or_slug/share', async (context) => {
    const auth = requireAuth(context);
    const body = parseBody(
      await readJson(context, ctx.config.jsonBodyLimitBytes),
      patchShareSchema
    );
    const passwordHash = body.password === null ? null : await createPasswordHash(body.password);
    return context.json(
      await patchShareResponse({
        db: requireDb(ctx),
        cloudModule: requireCloudModule(ctx),
        config: ctx.config,
        auth,
        idOrSlug: context.req.param('id_or_slug'),
        passwordHash,
      })
    );
  });

  v1.delete('/artifacts/:id_or_slug/share', async (context) => {
    const auth = requireAuth(context);
    return context.json(
      await deleteShareResponse({
        db: requireDb(ctx),
        accountId: auth.account.id,
        idOrSlug: context.req.param('id_or_slug'),
      })
    );
  });

  v1.get('/artifacts/:id_or_slug', async (context) => {
    const auth = requireAuth(context);
    return context.json(
      await getArtifactResponse({
        db: requireDb(ctx),
        cloudModule: requireCloudModule(ctx),
        config: ctx.config,
        account: auth.account,
        idOrSlug: context.req.param('id_or_slug'),
      })
    );
  });

  v1.put('/artifacts/:id_or_slug', async (context) => {
    const auth = requireAuth(context);
    const body = parseBody(
      await readJson(context, ctx.config.jsonBodyLimitBytes),
      updateArtifactSchema
    );
    const updatableFields = ['title', 'content', 'type', 'slug', 'metadata'] as const;
    if (!updatableFields.some((field) => body[field] !== undefined)) {
      throw new AppError(400, 'validation_failed', 'At least one updatable field is required');
    }
    ensureMetadataLimit(body.metadata);
    if (body.content !== undefined) {
      ensureContentLimit(body.content, ctx.config.maxContentBytes);
    }

    return context.json(
      await updateArtifact({
        db: requireDb(ctx),
        cloudModule: requireCloudModule(ctx),
        config: ctx.config,
        auth,
        idOrSlug: context.req.param('id_or_slug'),
        patch: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.content !== undefined ? { content: body.content } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
          ...(body.change_summary !== undefined ? { changeSummary: body.change_summary } : {}),
        },
      })
    );
  });

  v1.delete('/artifacts/:id_or_slug', async (context) => {
    const auth = requireAuth(context);
    return context.json(
      await deleteArtifact({
        db: requireDb(ctx),
        cloudModule: requireCloudModule(ctx),
        config: ctx.config,
        auth,
        idOrSlug: context.req.param('id_or_slug'),
      })
    );
  });

  v1.get('/templates', async (context) => {
    const auth = requireAuth(context);
    const query = parseQuery(context, templateListQuerySchema);
    return context.json(
      await listTemplatesResponse({
        db: requireDb(ctx),
        accountId: auth.account.id,
        options: {
          limit: query.limit,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
      })
    );
  });

  v1.post('/templates', async (context) => {
    const auth = requireAuth(context);
    const body = parseBody(
      await readJson(context, ctx.config.jsonBodyLimitBytes),
      promoteTemplateSchema
    );
    return context.json(
      await promoteTemplateResponse({
        db: requireDb(ctx),
        accountId: auth.account.id,
        artifactId: body.artifact_id,
        name: body.name,
        slug: body.slug,
        ...(body.description !== undefined ? { description: body.description } : {}),
      }),
      201
    );
  });

  v1.get('/templates/:slug', async (context) => {
    const auth = requireAuth(context);
    return context.json(
      await getTemplateResponse({
        db: requireDb(ctx),
        accountId: auth.account.id,
        slug: context.req.param('slug'),
      })
    );
  });

  methodNotAllowed(v1, '/contract', 'GET');
  methodNotAllowed(v1, '/openapi.json', 'GET');
  methodNotAllowed(v1, '/artifacts', 'GET, POST');
  methodNotAllowed(v1, '/artifacts/:id_or_slug', 'GET, PUT, DELETE');
  methodNotAllowed(v1, '/artifacts/:id_or_slug/versions', 'GET');
  methodNotAllowed(v1, '/artifacts/:id_or_slug/versions/:n', 'GET');
  methodNotAllowed(v1, '/artifacts/:id_or_slug/versions/:n/restore', 'POST');
  methodNotAllowed(v1, '/artifacts/:id_or_slug/share', 'POST, PATCH, DELETE');
  methodNotAllowed(v1, '/artifacts/:id_or_slug/download', 'GET');
  methodNotAllowed(v1, '/templates', 'GET, POST');
  methodNotAllowed(v1, '/templates/:slug', 'GET');

  app.route('/v1', v1);
}

function authMiddleware(ctx: V1RoutesContext): MiddlewareHandler<V1Env> {
  return async (context, next) => {
    const token = bearerToken(context.req.header('authorization'));
    const auth = await authenticateBotToken(requireDb(ctx), token);
    context.set('auth', auth);

    if (!ctx.config.rateLimitsDisabled) {
      enforceRateLimit(
        context,
        globalRateLimitStore,
        `v1:key:${auth.apiKeyHash}`,
        ctx.config.rateLimitRpm,
        60_000,
        true
      );

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(context.req.method)) {
        enforceRateLimit(
          context,
          globalRateLimitStore,
          `v1:write:${auth.apiKeyHash}`,
          ctx.config.rateLimitWritesPerMin,
          60_000,
          true
        );
      }
    }

    await next();
  };
}

function requireDb(ctx: V1RoutesContext): DatabaseHandle {
  if (!ctx.db) {
    throw new AppError(500, 'internal_error', 'Database is not configured');
  }
  return ctx.db;
}

function requireCloudModule(ctx: V1RoutesContext): CloudModule {
  if (!ctx.cloudModule) {
    throw new AppError(500, 'internal_error', 'Cloud module is not configured');
  }
  return ctx.cloudModule;
}

function requireAuth(context: Context<V1Env>): AuthPrincipal {
  return context.get('auth');
}

async function readJson(
  context: Context,
  maxBytes: number,
  optional = false
): Promise<Record<string, unknown>> {
  const contentLength = context.req.header('content-length');
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new AppError(413, 'payload_too_large', 'Request body exceeds the size limit', {
      limit_bytes: maxBytes,
      actual_bytes: Number(contentLength),
    });
  }

  const raw = await context.req.text();
  const actualBytes = Buffer.byteLength(raw, 'utf8');
  if (actualBytes > maxBytes) {
    throw new AppError(413, 'payload_too_large', 'Request body exceeds the size limit', {
      limit_bytes: maxBytes,
      actual_bytes: actualBytes,
    });
  }

  if (!raw.trim()) {
    if (optional) {
      return {};
    }
    throw new AppError(400, 'validation_failed', 'Request body must be JSON');
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('body must be an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new AppError(400, 'validation_failed', 'Request body must be valid JSON');
  }
}

function parseBody<T>(
  value: Record<string, unknown>,
  schema: {
    safeParse(
      input: unknown
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  }
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const issue = parsed.error.issues[0];
  throw new AppError(400, 'validation_failed', issue?.message ?? 'Validation failed', {
    ...(issue?.path[0] ? { field: String(issue.path[0]) } : {}),
    issues: parsed.error.issues.map((item) => ({
      field: item.path.join('.'),
      message: item.message,
    })),
  });
}

function parseQuery<T>(
  context: Context,
  schema: {
    safeParse(
      input: unknown
    ):
      | { success: true; data: T }
      | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } };
  }
): T {
  return parseBody(context.req.query(), schema);
}

function contractResponse(context: Context, config: AppConfig): Response {
  context.header('Content-Type', 'text/markdown; charset=utf-8');
  context.header('Cache-Control', 'public, max-age=3600');
  return context.body(contractText(config));
}

function contractText(config: AppConfig): string {
  return `# Agent Artifacts — API Contract (v1)

You have an Agent Artifacts account: a place to publish your work as beautiful,
versioned, shareable web pages. Read this document once — it is the entire API.

Base URL: ${config.baseUrl}/v1
Auth:     every request needs this header:
          Authorization: Bearer aa_bot_YOUR_KEY
          Any bot key can modify any artifact in its account — keys are
          account-scoped.

All bodies are JSON (snake_case). Timestamps are ISO-8601 UTC.
This markdown is available at GET /v1/contract and GET /llms.txt.
Machine-readable spec: /v1/openapi.json

Documented endpoints:
- POST /v1/artifacts
- GET /v1/artifacts
- GET /v1/artifacts/:id_or_slug
- PUT /v1/artifacts/:id_or_slug
- DELETE /v1/artifacts/:id_or_slug
- GET /v1/artifacts/:id_or_slug/versions
- GET /v1/artifacts/:id_or_slug/versions/:n
- POST /v1/artifacts/:id_or_slug/versions/:n/restore
- POST /v1/artifacts/:id_or_slug/share
- PATCH /v1/artifacts/:id_or_slug/share
- DELETE /v1/artifacts/:id_or_slug/share
- GET /v1/templates
- POST /v1/templates
- GET /v1/templates/:slug
- GET /v1/artifacts/:id_or_slug/download

## The one rule that matters: publish by slug

POST the same slug again = UPDATE. Same artifact, same public URL, new version
(full history kept). You never need to store ids — pick a stable slug per
document ("weekly-report", "deploy-status") and re-POST whenever it changes.
If content is identical, nothing happens (response has "unchanged": true).
Re-POSTing is always safe.
Re-POSTing a slug with a different type converts the artifact.
Artifacts may carry expires_at (null = permanent). Re-publishing the same slug resets the clock.

## 1. Publish (create or update) — POST /artifacts

curl -X POST ${config.baseUrl}/v1/artifacts \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"slug":"weekly-report","type":"markdown","title":"Weekly Report — W34",
       "content":"# Weekly Report\\n...","change_summary":"Added incident retro",
       "share":true}'

- type: "markdown" or "html". Max content: 2 MB.
- slug is optional — derived from the title; two documents that must stay
  separate need distinct slugs.
- share:true → response includes share.url — a stable public link. Send it to
  your human. The link LIVE-UPDATES when you re-publish: same URL, new content.
- In the JSON response, the public URL is exactly at response.share.url.
- "password":"secret123" → the public page requires that password (share implied).
- Response: 201 created / 200 updated, with id, slug, version_num, share.url.

## 2. Publish with a template — consistent, on-brand output

GET /v1/templates                       → list (each has a slots array)
GET /v1/templates/report                → details incl. required slots

curl -X POST ${config.baseUrl}/v1/artifacts \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"slug":"weekly-report","title":"Week 34","template":"report",
       "slots":{"title":"Week 34","date":"2026-08-25","summary":"Shipped v2.1 ...",
                "body":"## Highlights\\n...","next_steps":"- Ship v2.2"},"share":true}'

Send template + slots INSTEAD of type + content (server merges them).
Missing/unknown slot names come back as a 400 that lists the valid slots.

## 3. Promote an artifact into a template — POST /templates

Markdown-only. Put {{slot_name}} markers in an existing markdown artifact, then
promote it into an account template your bots can reuse with template + slots.
HTML artifacts are rejected in v1.

curl -X POST ${config.baseUrl}/v1/templates \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"artifact_id":"art_abcdefghijklmnopqrstu","name":"Ops Brief","slug":"ops-brief",
       "description":"Optional short description"}'

Request body:
- artifact_id: existing markdown artifact id in your account.
- name: template display name (1..80 chars).
- slug: lowercase letters/numbers/dashes, unique among your account templates.
- description: optional short description (max 300 chars).

Response: 201 with id, slug, name, description, type:"markdown",
built_in:false, content, slots, created_at, updated_at. The slots list is
derived from {{slot_name}} markers in the artifact content.

Errors:
- 409 slug_conflict when the slug already exists.
- 400 validation_failed with details.field="type" and
  details.reason="html_not_supported" for HTML artifacts.
- 400 validation_failed with details.field="content" and
  details.reason="no_slots" when no {{slot}} markers are found.
- 404 not_found when artifact_id is unknown or deleted.

## 4. Read back — GET

GET /v1/artifacts                        → list (newest first; no content)
    filters: ?bot=bot_ID  ?type=markdown  ?updated_since=2026-08-01T00:00:00Z
    paging:  ?limit=20&cursor=...  → { "items": [...], "next_cursor": "..."|null }
GET /v1/artifacts/weekly-report          → one artifact, full content + share state
    (works with the slug or the art_... id)

## 5. Update explicitly — PUT /artifacts/:slug

Same as re-POSTing, useful for partial changes (title only, etc.):
curl -X PUT .../v1/artifacts/weekly-report -H "Authorization: Bearer aa_bot_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"# Updated...","change_summary":"Fixed numbers"}'
Every content change = a new version. History:
GET .../weekly-report/versions           POST .../versions/3/restore
All versions of a shared artifact are publicly viewable via the version picker.
To bury history, delete the artifact and re-publish under a new slug.

## 6. Sharing — POST/PATCH/DELETE /artifacts/:slug/share

POST   .../share                     → { "url": "${config.baseUrl}/a/..." }
POST   .../share {"password":"s3cret"}  → password-protected link
PATCH  .../share {"password":null}      → remove password
DELETE .../share                        → revoke; the old URL is dead (410) forever.
                                          POST again later = a NEW url.

Also: GET .../weekly-report/download → raw .md/.html file.
DELETE /v1/artifacts/weekly-report   → soft-delete (share revoked too).

## Limits & errors

- 2 MB per artifact · 60 requests/min · 10 writes/min (429 + Retry-After when over).
- Errors are always: { "error": { "code": "snake_case", "message": "...", "details": {...} } }
  Common codes: unauthorized (401), not_found (404), validation_failed (400),
  payload_too_large (413), rate_limited (429), slug_conflict (409).

## Habits worth forming

One stable slug per living document; re-publish freely (the URL never changes).
Always send change_summary. Use a template when one fits. Add a password when
content is sensitive. Share the url with your human.
`;
}

function openApiDocument(config: AppConfig): Record<string, unknown> {
  const json = { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } };
  const errorResponses = {
    '400': { description: 'Validation failed', content: json },
    '401': { description: 'Unauthorized', content: json },
    '403': { description: 'Forbidden or quota exceeded', content: json },
    '404': { description: 'Not found', content: json },
    '405': { description: 'Method not allowed', content: json },
    '409': { description: 'Slug conflict', content: json },
    '413': { description: 'Payload too large', content: json },
    '429': { description: 'Rate limited', content: json },
    '500': { description: 'Internal error', content: json },
  };
  const security = [{ BotAuth: [] }];

  return {
    openapi: '3.1.0',
    info: { title: 'Agent Artifacts API', version: '0.1.0' },
    servers: [{ url: `${config.baseUrl}/v1` }],
    paths: {
      '/contract': {
        get: {
          summary: 'API contract',
          responses: {
            '200': {
              description: 'Markdown contract for agents',
              content: { 'text/markdown': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          summary: 'OpenAPI document',
          responses: { '200': { description: 'OpenAPI 3.1 JSON document' } },
        },
      },
      '/artifacts': {
        get: {
          summary: 'List artifacts',
          security,
          parameters: queryParameters(['bot', 'type', 'updated_since', 'q', 'limit', 'cursor']),
          responses: { '200': { description: 'Artifact page' }, ...errorResponses },
        },
        post: {
          summary: 'Create or upsert artifact',
          security,
          requestBody: requestBodyRef('PublishArtifactRequest'),
          responses: {
            '200': { description: 'Artifact updated or unchanged' },
            '201': { description: 'Artifact created' },
            ...errorResponses,
          },
        },
      },
      '/artifacts/{id_or_slug}': {
        get: {
          summary: 'Get artifact',
          security,
          parameters: pathParameters(['id_or_slug']),
          responses: { '200': { description: 'Artifact' }, ...errorResponses },
        },
        put: {
          summary: 'Update artifact',
          security,
          parameters: pathParameters(['id_or_slug']),
          requestBody: requestBodyRef('UpdateArtifactRequest'),
          responses: { '200': { description: 'Artifact updated or unchanged' }, ...errorResponses },
        },
        delete: {
          summary: 'Soft-delete artifact',
          security,
          parameters: pathParameters(['id_or_slug']),
          responses: { '200': { description: 'Delete result' }, ...errorResponses },
        },
      },
      '/artifacts/{id_or_slug}/versions': {
        get: {
          summary: 'List versions',
          security,
          parameters: [...pathParameters(['id_or_slug']), ...queryParameters(['limit', 'cursor'])],
          responses: { '200': { description: 'Version page' }, ...errorResponses },
        },
      },
      '/artifacts/{id_or_slug}/versions/{n}': {
        get: {
          summary: 'Get version',
          security,
          parameters: [...pathParameters(['id_or_slug', 'n'])],
          responses: { '200': { description: 'Artifact version' }, ...errorResponses },
        },
      },
      '/artifacts/{id_or_slug}/versions/{n}/restore': {
        post: {
          summary: 'Restore version',
          security,
          parameters: [...pathParameters(['id_or_slug', 'n'])],
          requestBody: requestBodyRef('RestoreVersionRequest'),
          responses: { '201': { description: 'Restored version' }, ...errorResponses },
        },
      },
      '/artifacts/{id_or_slug}/share': {
        post: {
          summary: 'Create or reuse share',
          security,
          parameters: pathParameters(['id_or_slug']),
          requestBody: requestBodyRef('CreateShareRequest'),
          responses: {
            '200': { description: 'Existing share reused' },
            '201': { description: 'Share created' },
            ...errorResponses,
          },
        },
        patch: {
          summary: 'Set or remove share password',
          security,
          parameters: pathParameters(['id_or_slug']),
          requestBody: requestBodyRef('PatchShareRequest'),
          responses: { '200': { description: 'Share updated' }, ...errorResponses },
        },
        delete: {
          summary: 'Revoke share',
          security,
          parameters: pathParameters(['id_or_slug']),
          responses: { '200': { description: 'Share revoke result' }, ...errorResponses },
        },
      },
      '/templates': {
        get: {
          summary: 'List templates',
          security,
          parameters: queryParameters(['limit', 'cursor']),
          responses: { '200': { description: 'Template page' }, ...errorResponses },
        },
        post: {
          summary: 'Promote a markdown artifact to an account template',
          security,
          requestBody: requestBodyRef('PromoteTemplateRequest'),
          responses: { '201': { description: 'Template created' }, ...errorResponses },
        },
      },
      '/templates/{slug}': {
        get: {
          summary: 'Get template',
          security,
          parameters: pathParameters(['slug']),
          responses: { '200': { description: 'Template' }, ...errorResponses },
        },
      },
      '/artifacts/{id_or_slug}/download': {
        get: {
          summary: 'Download artifact content',
          security,
          parameters: pathParameters(['id_or_slug']),
          responses: {
            '200': {
              description: 'Raw markdown or HTML content',
              content: {
                'text/markdown': { schema: { type: 'string' } },
                'text/html': { schema: { type: 'string' } },
              },
            },
            ...errorResponses,
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BotAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'aa_bot_<nanoid32>',
        },
      },
      schemas: {
        ErrorEnvelope: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object', additionalProperties: true },
                request_id: { type: 'string' },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        PublishArtifactRequest: jsonSchema(publishArtifactSchema),
        UpdateArtifactRequest: jsonSchema(updateArtifactSchema),
        RestoreVersionRequest: jsonSchema(restoreVersionSchema),
        CreateShareRequest: jsonSchema(createShareSchema),
        PatchShareRequest: jsonSchema(patchShareSchema),
        PromoteTemplateRequest: jsonSchema(promoteTemplateSchema),
        ArtifactListQuery: jsonSchema(artifactListQuerySchema),
        VersionListQuery: jsonSchema(versionListQuerySchema),
        TemplateListQuery: jsonSchema(templateListQuerySchema),
      },
    },
  };
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
}

function requestBodyRef(schemaName: string): Record<string, unknown> {
  return {
    required: true,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${schemaName}` },
      },
    },
  };
}

function pathParameters(names: string[]): Array<Record<string, unknown>> {
  return names.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: name === 'n' ? 'integer' : 'string' },
  }));
}

function queryParameters(names: string[]): Array<Record<string, unknown>> {
  return names.map((name) => ({
    name,
    in: 'query',
    required: false,
    schema: { type: name === 'limit' ? 'integer' : 'string' },
  }));
}

function methodNotAllowed(app: Hono<V1Env>, path: string, allow: string): void {
  app.all(path, (context) => {
    context.header('Allow', allow);
    throw new AppError(405, 'method_not_allowed', 'Method not allowed');
  });
}
