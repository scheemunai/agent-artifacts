import type { Context, Env, Hono, MiddlewareHandler } from 'hono';
import { Hono as HonoApp } from 'hono';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { DatabaseHandle } from '../../db/client.js';
import type { CloudModule } from '../../extension/cloud-module.js';
import { AppError } from '../../lib/errors.js';
import {
  clientIp,
  enforceRateLimit,
  globalRateLimitStore,
  refundRateLimit,
} from '../../lib/rate-limit.js';
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
import { type ValidationIssue, validationFailed } from '../../lib/validation.js';
import type { Logger } from '../../logger.js';
import {
  deleteTemplateResponse,
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
  revokeShareResponse,
  updateArtifact,
} from '../../services/v1.js';
import { skillResponse } from '../skill.js';

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
  app.get('/skill.md', unauthRateLimit, (context) => skillResponse(context, ctx.config));
  app.all('/skill.md', (context) => {
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

  // Burn the link. What DELETE used to do, kept as its own verb so the promise the contract has
  // always made — a revoked URL is dead forever — is still available now that DELETE unpublishes.
  v1.post('/artifacts/:id_or_slug/share/revoke', async (context) => {
    const auth = requireAuth(context);
    return context.json(
      await revokeShareResponse({
        db: requireDb(ctx),
        cloudModule: requireCloudModule(ctx),
        config: ctx.config,
        account: auth.account,
        idOrSlug: context.req.param('id_or_slug'),
      })
    );
  });

  v1.delete('/artifacts/:id_or_slug/share', async (context) => {
    const auth = requireAuth(context);
    return context.json(
      await deleteShareResponse({
        db: requireDb(ctx),
        cloudModule: requireCloudModule(ctx),
        config: ctx.config,
        account: auth.account,
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
          ...(query.category ? { category: query.category } : {}),
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
        ...(body.category !== undefined ? { category: body.category } : {}),
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

  v1.delete('/templates/:slug', async (context) => {
    const auth = requireAuth(context);
    return context.json(
      await deleteTemplateResponse({
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
  methodNotAllowed(v1, '/artifacts/:id_or_slug/share/revoke', 'POST');
  methodNotAllowed(v1, '/artifacts/:id_or_slug/download', 'GET');
  methodNotAllowed(v1, '/templates', 'GET, POST');
  methodNotAllowed(v1, '/templates/:slug', 'GET, DELETE');

  app.route('/v1', v1);
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * The write budget prices writes, not attempts.
 *
 * It has to be taken before the handler runs — it is a gate, not an invoice — but a request that
 * comes back 4xx never wrote anything, so the token is handed back once the outcome is known. An
 * agent doing ordinary work (create → update → share) with a typo in the middle of it used to walk
 * into a 429 on its fourth *successful* call, which reads as "the service is broken" rather than
 * "you are going too fast".
 *
 * Traffic is still priced: the per-key request limit above charges every call, refused ones
 * included, so this cannot be turned into an unmetered retry loop.
 */
function authMiddleware(ctx: V1RoutesContext): MiddlewareHandler<V1Env> {
  return async (context, next) => {
    // `/artifacts` and `/artifacts/*` are both registered, and a collection request matches BOTH,
    // so this middleware is entered twice for `POST /v1/artifacts` and once for
    // `PUT /v1/artifacts/:slug`. Authenticating twice is only waste; charging the rate limit twice
    // was the bug — it silently halved both published budgets on the collection endpoints, so the
    // "10 writes/min" in the contract was really 5, and only when publishing. The registrations
    // stay (matching a collection with a trailing wildcard is a router detail, not a promise); the
    // work is what becomes once-per-request.
    if (context.get('auth')) {
      await next();
      return;
    }

    const token = bearerToken(context.req.header('authorization'));
    const auth = await authenticateBotToken(requireDb(ctx), token);
    context.set('auth', auth);

    if (ctx.config.rateLimitsDisabled) {
      await next();
      return;
    }

    enforceRateLimit(
      context,
      globalRateLimitStore,
      `v1:key:${auth.apiKeyHash}`,
      ctx.config.rateLimitRpm,
      60_000,
      true
    );

    if (!WRITE_METHODS.has(context.req.method)) {
      await next();
      return;
    }

    const writeKey = `v1:write:${auth.apiKeyHash}`;
    const writeLimit = ctx.config.rateLimitWritesPerMin;
    enforceRateLimit(context, globalRateLimitStore, writeKey, writeLimit, 60_000, true);

    const refundWrite = (): void => {
      refundRateLimit(context, globalRateLimitStore, writeKey, writeLimit, true);
    };

    // Both exits are real. A thrown AppError normally reaches the error handler as a response
    // before this middleware resumes, but a handler further out can also reject outright, and a
    // rejection that skipped the refund would silently reinstate the bug.
    try {
      await next();
    } catch (error) {
      if (error instanceof AppError && isClientError(error.status)) {
        refundWrite();
      }
      throw error;
    }

    if (isClientError(context.res.status)) {
      refundWrite();
    }
  };
}

/** 4xx except 429: the request the limiter itself refused keeps its token, so it cannot loop. */
function isClientError(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
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

interface ParsableSchema<T> {
  safeParse(
    input: unknown
  ): { success: true; data: T } | { success: false; error: { issues: ValidationIssue[] } };
}

function parseBody<T>(value: Record<string, unknown>, schema: ParsableSchema<T>): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  throw validationFailed(parsed.error.issues);
}

function parseQuery<T>(context: Context, schema: ParsableSchema<T>): T {
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
Agent publishing skill: GET /skill.md
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
- POST /v1/artifacts/:id_or_slug/share/revoke
- GET /v1/templates            (?category= to narrow; built-ins and your own together)
- POST /v1/templates
- GET /v1/templates/:slug
- DELETE /v1/templates/:slug
- GET /v1/artifacts/:id_or_slug/download

## The one rule that matters: publish by slug

POST the same slug again = UPDATE. Same artifact, same public URL, new version
(full history kept). You never need to store ids — pick a stable slug per
document ("weekly-report", "deploy-status") and re-POST whenever it changes.
If content is identical, nothing happens (response has "unchanged": true).
Re-POSTing is always safe.
Re-POSTing a slug with a different type converts the artifact.
Retention is server-owned: artifact and share responses may include response-only
expires_at metadata (null = permanent), but expires_at is never accepted in
POST/PUT/PATCH request bodies. Re-publishing the same slug resets only the
server-managed retention clock.

## 1. Publish (create or update) — POST /artifacts

curl -X POST ${config.baseUrl}/v1/artifacts \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"slug":"weekly-report","type":"markdown","title":"Weekly Report — W34",
       "content":"# Weekly Report\\n...","change_summary":"Added incident retro",
       "share":true}'

Accepted POST /v1/artifacts request fields (strict; unknown fields return 400 validation_failed): \`slug\`, \`type\`, \`title\`, \`content\`, \`template\`, \`slots\`, \`metadata\`, \`change_summary\`, \`share\`, \`password\`.
Do not send response-only fields such as \`id\`, \`version_num\`, \`share.url\`, \`created_at\`, \`updated_at\`, or \`expires_at\`.

- type: "markdown" or "html". Max content: 2 MB.
- slug is optional — derived from the title; two documents that must stay
  separate need distinct slugs.
- NEW ARTIFACTS ARE PRIVATE. You always get share.url back, and only you —
  signed in to your dashboard — can open it. Anyone else gets "not found".
- \`share\` and \`password\` are ACCEPTED AND IGNORED here; the response says so in
  share.ignored_request. Creation cannot publish. See §6 for how to publish.
- In the JSON response, the URL is exactly at response.share.url, and
  response.share.visibility tells you who can open it right now.
- The link LIVE-UPDATES when you re-publish: same URL, new content. Publishing
  never changes the URL, so you can hand it over before you publish.
- Response: 201 created / 200 updated, with id, slug, version_num, share.url.

## 2. Publish with a template — consistent, on-brand output

GET /v1/templates                       → list (each has a slots array)
GET /v1/templates/report                → details incl. content, type and slots

curl -X POST ${config.baseUrl}/v1/artifacts \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"slug":"weekly-report","title":"Week 34","template":"report",
       "slots":{"title":"Week 34","date":"2026-08-25","summary":"Shipped v2.1 ...",
                "body":"## Highlights\\n...","next_steps":"- Ship v2.2"},"share":true}'

Send template + slots INSTEAD of type + content (server uses the template's type).
For templates with slots, missing/unknown slot names come back as a 400 that
lists the valid slots. Templates with no slots are copied verbatim.

### Zero-slot templates: fetch, rewrite, publish (do NOT use template:)

Check the slots array before you reach for \`template:\`. Several built-ins ship
with \`"slots": []\` — today \`recap\`, \`metrics-dashboard\` and \`report-html\`, all
HTML. A zero-slot template is an EXAMPLE, not a form. \`template:"recap"\` copies
that example VERBATIM and any \`slots\` you send are silently ignored, so you get a
201 and the demo content, not your content. That is working as designed, and it
is not what you wanted.

The intended flow for a zero-slot template is three steps:

  1. GET /v1/templates/recap        → read \`content\` (and \`type\`)
  2. Rewrite that content yourself, keeping its structure and styling and
     replacing every piece of copy with yours.
  3. POST /v1/artifacts {"slug":"...","type":"html","title":"...",
     "content":"<your rewritten document>"} — an ordinary publish. No
     \`template\` field.

Rule of thumb: slots non-empty → send \`template\` + \`slots\`. Slots empty → GET it,
rehash it, publish it as \`type\`+\`content\`.

## 3. Promote an artifact into a template — POST /templates

Promote an existing markdown or HTML artifact into an account template your bots
can reuse. Put {{slot_name}} markers in the artifact when you want callers to
provide values; omit slots when you want the template copied verbatim.

curl -X POST ${config.baseUrl}/v1/templates \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" -H "Content-Type: application/json" \\
  -d '{"artifact_id":"art_abcdefghijklmnopqrstu","name":"Ops Brief","slug":"ops-brief",
       "description":"Optional short description"}'

Request body:
- artifact_id: existing artifact id in your account.
- name: template display name (1..80 chars).
- slug: lowercase letters/numbers/dashes, unique among your account templates AND
  distinct from every built-in slug. Built-in slugs (report, changelog, briefing,
  dashboard, one-pager, recap, metrics-dashboard, report-html) are RESERVED: you
  cannot create a template that shadows one.
- description: optional short description (max 300 chars).

Response: 201 with id, slug, name, description, thumbnail_url, type,
built_in:false, content, slots, created_at, updated_at. The type matches the
source artifact. The slots list is derived from {{slot_name}} markers in the
artifact content, or is empty for verbatim templates.

Errors:
- 409 slug_conflict when the slug already exists in your account, or when it is
  reserved by a built-in (details.built_in:true).
- 404 not_found when artifact_id is unknown or deleted.

### Delete one of your templates — DELETE /templates/:slug

curl -X DELETE ${config.baseUrl}/v1/templates/ops-brief \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY"

Response: 200 { "deleted": true, "id": "tpl_...", "slug": "ops-brief" }.
Only your own account templates can be deleted; artifacts already published from
the template are untouched.

Errors:
- 403 built_in_template when the slug names a built-in template.
- 404 not_found when your account has no template with that slug.

## 4. Read back — GET

GET /v1/artifacts                        → list (newest first; no content)
    filters: ?bot=bot_ID  ?type=markdown  ?updated_since=2026-08-01T00:00:00Z
             ?q=weekly   — case-insensitive "contains" over title and slug only
                           (NOT content), max 80 chars, treated as literal text
                           rather than a pattern; combines with the filters above
    paging:  ?limit=20&cursor=...  → { "items": [...], "next_cursor": "..."|null }
GET /v1/artifacts/weekly-report          → one artifact, full content + share state
    (works with the slug or the art_... id)

## 5. Update explicitly — PUT /artifacts/:slug

Same as re-POSTing, useful for partial changes (title only, etc.):
curl -X PUT .../v1/artifacts/weekly-report -H "Authorization: Bearer aa_bot_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"# Updated...","change_summary":"Fixed numbers"}'
Accepted PUT /v1/artifacts/:id_or_slug request fields (strict; unknown fields return 400 validation_failed): \`title\`, \`content\`, \`type\`, \`slug\`, \`metadata\`, \`change_summary\`.
PUT does not accept \`template\`, \`slots\`, \`share\`, \`password\`, or response-only \`expires_at\`.
Every change = a new version, and a title is a change: PUT {"title":"..."} alone
bumps version_num. Re-sending values identical to the current ones changes
nothing ("unchanged": true). History:
GET .../weekly-report/versions           POST .../versions/3/restore
Restore answers 201 with a VERSION object — artifact_id, version_num, type,
title, content, content_hash, change_summary, restored_from_version,
created_by_bot, created_at, plus an "artifact" summary of the new current state.
It is not a full artifact: there is no top-level slug and no share block, so read
share.url from the publish response or GET /v1/artifacts/:id_or_slug instead.
Version history is account-private. On the public share page only you — signed in
to your dashboard — can browse or pin past versions with the version picker;
anonymous visitors always get the latest, and \`?v=\` is ignored for them. Your bot
key still reads any version through the endpoints above. To roll a public page
back, restore a previous version; to remove history entirely, delete the artifact
and re-publish under a new slug.

## 6. Publishing — POST/PATCH/DELETE /artifacts/:slug/share

An artifact has one of three visibilities. It starts, always, at the first one.

  private   only you, signed in to your dashboard. Everyone else gets 404 on the
            page, the content, the download, the frame AND the social card — a
            private artifact does not disclose that it exists, and has no
            preview image.
  public    anyone with the link.
  password  anyone with the link AND the password.

POST   .../share                     → PUBLISH. { "url": ".../a/...", "visibility": "public" }
POST   .../share {"password":"s3cret"}  → publish behind a password
PATCH  .../share {"password":"s3cret"}  → add/replace the password
PATCH  .../share {"password":null}      → remove the password (stays public)
DELETE .../share                        → UNPUBLISH: back to private. The URL survives,
                                          so publishing again makes the SAME link live.
POST   .../share/revoke                 → BURN THE LINK: dead (410) forever.
                                          Publishing later mints a NEW url.

Use DELETE when you published too early. Use revoke when the link leaked.

Also: GET .../weekly-report/download → raw .md/.html file.
DELETE /v1/artifacts/weekly-report   → soft-delete (share revoked too).

## Limits & errors

- 2 MB per artifact · 60 requests/min · 10 writes/min (429 + Retry-After when over,
  and details.retry_after carries the same number of seconds).
- Only writes that succeed count against the 10/min write budget. A write that
  comes back 4xx — a validation slip, a 409, a 404 — is refunded, so a typo in the
  middle of ordinary work does not cost you a publish. Every request, refused ones
  included, still counts against the 60/min request budget.
- Errors are always: { "error": { "code": "snake_case", "message": "...", "details": {...} } }
  A private artifact answers not_found (404) to everyone but its owner — the same
  answer a share id that never existed gets, on purpose.
  Common codes: unauthorized (401), not_found (404), validation_failed (400),
  payload_too_large (413), rate_limited (429), slug_conflict (409),
  built_in_template (403).
  On a rejected unknown field, details.field and details.issues[].field name the
  key that was rejected.

## Habits worth forming

One stable slug per living document; re-publish freely (the URL never changes).
Always send change_summary. Use a template when one fits. Create first, then
publish deliberately with POST /share — and only when your human has said the
content is theirs to share. Add a password when content is sensitive.
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
          summary: 'Unpublish (back to private)',
          description:
            'Returns the artifact to private. The share URL survives and works again if you publish later.',
          security,
          parameters: pathParameters(['id_or_slug']),
          responses: { '200': { description: 'Unpublish result' }, ...errorResponses },
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
          summary: 'Promote an artifact to an account template',
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
        delete: {
          summary: 'Delete an account template',
          description:
            'Deletes one of the caller account’s own templates. Built-in templates are not deletable and answer 403 built_in_template.',
          security,
          parameters: pathParameters(['slug']),
          responses: { '200': { description: 'Template deleted' }, ...errorResponses },
        },
      },
      '/artifacts/{id_or_slug}/share/revoke': {
        post: {
          summary: 'Revoke the share URL permanently',
          description:
            'Kills the share URL for good: it answers 410 forever and publishing again mints a new id. Use DELETE /share to unpublish reversibly.',
          security,
          parameters: pathParameters(['id_or_slug']),
          responses: { '200': { description: 'Share revoked' }, ...errorResponses },
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
