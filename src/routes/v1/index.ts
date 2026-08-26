import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import { Hono as HonoApp } from 'hono';
import type { AppConfig } from '../../config.js';
import type { DatabaseHandle } from '../../db/client.js';
import type { CloudModule } from '../../extension/cloud-module.js';
import { AppError } from '../../lib/errors.js';
import { clientIp, enforceRateLimit, globalRateLimitStore } from '../../lib/rate-limit.js';
import {
  artifactListQuerySchema,
  createShareSchema,
  patchShareSchema,
  publishArtifactSchema,
  restoreVersionSchema,
  templateListQuerySchema,
  updateArtifactSchema,
  versionListQuerySchema,
} from '../../lib/schemas/index.js';
import type { Logger } from '../../logger.js';
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
  getTemplateResponse,
  getVersionResponse,
  listArtifactsResponse,
  listTemplatesResponse,
  listVersionsResponse,
  mergeTemplate,
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
  methodNotAllowed(v1, '/templates', 'GET');
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
Machine-readable spec: GET /v1/openapi.json

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

## 3. Read back — GET

GET /v1/artifacts                        → list (newest first; no content)
    filters: ?bot=bot_ID  ?type=markdown  ?updated_since=2026-08-01T00:00:00Z
    paging:  ?limit=20&cursor=...  → { "items": [...], "next_cursor": "..."|null }
GET /v1/artifacts/weekly-report          → one artifact, full content + share state
    (works with the slug or the art_... id)

## 4. Update explicitly — PUT /artifacts/:slug

Same as re-POSTing, useful for partial changes (title only, etc.):
curl -X PUT .../v1/artifacts/weekly-report -H "Authorization: Bearer aa_bot_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"# Updated...","change_summary":"Fixed numbers"}'
Every content change = a new version. History:
GET .../weekly-report/versions           POST .../versions/3/restore
All versions of a shared artifact are publicly viewable via the version picker.
To bury history, delete the artifact and re-publish under a new slug.

## 5. Sharing — POST/PATCH/DELETE /artifacts/:slug/share

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
  return {
    openapi: '3.1.0',
    info: { title: 'Agent Artifacts API', version: '0.1.0' },
    servers: [{ url: `${config.baseUrl}/v1` }],
    paths: {
      '/contract': { get: { summary: 'API contract' } },
      '/openapi.json': { get: { summary: 'OpenAPI document' } },
      '/artifacts': {
        get: { summary: 'List artifacts' },
        post: { summary: 'Create or upsert artifact' },
      },
      '/artifacts/{id_or_slug}': {
        get: { summary: 'Get artifact' },
        put: { summary: 'Update artifact' },
        delete: { summary: 'Soft-delete artifact' },
      },
      '/artifacts/{id_or_slug}/versions': { get: { summary: 'List versions' } },
      '/artifacts/{id_or_slug}/versions/{n}': { get: { summary: 'Get version' } },
      '/artifacts/{id_or_slug}/versions/{n}/restore': { post: { summary: 'Restore version' } },
      '/artifacts/{id_or_slug}/share': {
        post: { summary: 'Create or reuse share' },
        patch: { summary: 'Set or remove share password' },
        delete: { summary: 'Revoke share' },
      },
      '/templates': { get: { summary: 'List templates' } },
      '/templates/{slug}': { get: { summary: 'Get template' } },
      '/artifacts/{id_or_slug}/download': { get: { summary: 'Download artifact content' } },
    },
  };
}

function methodNotAllowed(app: Hono<V1Env>, path: string, allow: string): void {
  app.all(path, (context) => {
    context.header('Allow', allow);
    throw new AppError(405, 'method_not_allowed', 'Method not allowed');
  });
}
