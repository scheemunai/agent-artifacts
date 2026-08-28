import { describe, expect, it } from 'vitest';
import type { CloudModule } from '../../src/extension/cloud-module.js';
import { AppError } from '../../src/lib/errors.js';
import { countRows, createApiTestContext, createV1OnlyApp, json } from './api-test-utils.js';

const jsonContent = { 'Content-Type': 'application/json' };

function publishBody(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'weekly-report',
    type: 'markdown',
    title: 'Weekly Report',
    content: '# Weekly Report',
    ...overrides,
  };
}

describe('V1 API auth and errors', () => {
  it('authenticates valid bot keys and rejects missing, malformed, and revoked keys', async () => {
    const ctx = await createApiTestContext();

    try {
      const missing = await ctx.app.request('/v1/templates');
      expect(missing.status).toBe(401);
      expect(missing.headers.get('WWW-Authenticate')).toBe('Bearer');
      expect(await json(missing)).toMatchObject({ error: { code: 'unauthorized' } });

      const malformed = await ctx.app.request('/v1/templates', {
        headers: { Authorization: 'Bearer not-a-bot-key' },
      });
      expect(malformed.status).toBe(401);
      expect(await json(malformed)).toMatchObject({ error: { code: 'unauthorized' } });

      const noDatabaseApp = createV1OnlyApp({ config: ctx.config });
      const malformedWithoutDatabase = await noDatabaseApp.request('/v1/templates', {
        headers: { Authorization: 'Bearer not-a-bot-key' },
      });
      expect(malformedWithoutDatabase.status).toBe(401);

      const valid = await ctx.app.request('/v1/templates', { headers: ctx.authHeaders });
      expect(valid.status).toBe(200);
      expect(await json(valid)).toMatchObject({ next_cursor: null });

      ctx.db.sqlite
        .prepare('UPDATE bots SET revoked_at = ? WHERE id = ?')
        .run(Date.now(), ctx.bot.id);
      const revoked = await ctx.app.request('/v1/templates', { headers: ctx.authHeaders });
      expect(revoked.status).toBe(401);
      expect(await json(revoked)).toMatchObject({ error: { code: 'unauthorized' } });
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns account_suspended for every bot request on a suspended account', async () => {
    const ctx = await createApiTestContext({ suspended: true });

    try {
      const response = await ctx.app.request('/v1/templates', { headers: ctx.authHeaders });
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({ error: { code: 'account_suspended' } });
    } finally {
      await ctx.cleanup();
    }
  });

  it('exposes route-level error codes for catalog entries owned by the v1 API', async () => {
    const ctx = await createApiTestContext({ maxContentBytes: 16 });

    try {
      const notFound = await ctx.app.request('/v1/artifacts/missing', { headers: ctx.authHeaders });
      expect(notFound.status).toBe(404);
      expect(await json(notFound)).toMatchObject({ error: { code: 'not_found' } });

      const method = await ctx.app.request('/v1/templates', {
        method: 'PUT',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: '{}',
      });
      expect(method.status).toBe(405);
      expect(method.headers.get('Allow')).toBe('GET, POST');
      expect(await json(method)).toMatchObject({ error: { code: 'method_not_allowed' } });

      const validation = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ title: '' })),
      });
      expect(validation.status).toBe(400);
      expect(await json(validation)).toMatchObject({ error: { code: 'validation_failed' } });

      const payload = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ content: 'x'.repeat(17) })),
      });
      expect(payload.status).toBe(413);
      expect(await json(payload)).toMatchObject({
        error: { code: 'payload_too_large', details: { limit_bytes: 16 } },
      });

      const first = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'first' })),
      });
      expect(first.status).toBe(201);
      const second = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'second' })),
      });
      expect(second.status).toBe(201);
      const conflict = await ctx.app.request('/v1/artifacts/second', {
        method: 'PUT',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ slug: 'first' }),
      });
      expect(conflict.status).toBe(409);
      expect(await json(conflict)).toMatchObject({ error: { code: 'slug_conflict' } });
    } finally {
      await ctx.cleanup();
    }
  });

  it('rate-limits writes with 429 and Retry-After', async () => {
    const ctx = await createApiTestContext({ rateLimitsDisabled: false });

    try {
      let response: Response | null = null;
      for (let index = 0; index < 11; index += 1) {
        response = await ctx.app.request('/v1/artifacts', {
          method: 'POST',
          headers: { ...ctx.authHeaders, ...jsonContent },
          body: JSON.stringify(publishBody({ slug: 'rate-limited' })),
        });
      }

      expect(response?.status).toBe(429);
      expect(response?.headers.get('Retry-After')).toMatch(/^\d+$/);
      expect(await json(response as Response)).toMatchObject({ error: { code: 'rate_limited' } });
    } finally {
      await ctx.cleanup();
    }
  });

  it('maps quota-denied cloud hooks to 403 quota_exceeded without side effects', async () => {
    const denyingModule: CloudModule = {
      resolvePlan: async () => ({
        id: 'test-deny',
        name: 'Test deny',
        showFooter: true,
        limits: { maxBots: null, maxArtifacts: 0 },
        artifact_retention_days: null,
      }),
      checkQuota: async (_account, action) => {
        if (action.type === 'create_artifact') {
          return { allow: false, code: 'artifact_limit', message: 'Artifact limit reached' };
        }
        return { allow: true };
      },
    };
    const ctx = await createApiTestContext({ cloudModule: denyingModule });

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'quota-denied' })),
      });
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({
        error: { code: 'quota_exceeded', message: 'Artifact limit reached' },
      });
      expect(countRows(ctx.db, 'artifacts')).toBe(0);
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps the complete catalog representable by the route error mapper', async () => {
    const ctx = await createApiTestContext();
    const statusByCode = {
      unauthorized: 401,
      password_required: 401,
      password_invalid: 401,
      forbidden: 403,
      quota_exceeded: 403,
      account_suspended: 403,
      origin_mismatch: 403,
      not_found: 404,
      method_not_allowed: 405,
      slug_conflict: 409,
      share_revoked: 410,
      share_expired: 410,
      validation_failed: 400,
      payload_too_large: 413,
      rate_limited: 429,
      internal_error: 500,
    } as const;

    try {
      const app = createV1OnlyApp({ config: ctx.config });
      app.get('/boom/:code', (context) => {
        const code = context.req.param('code') as keyof typeof statusByCode;
        const status = statusByCode[code];
        if (!status) {
          throw new Error('unexpected');
        }
        throw new AppError(status, code, `${code} test`, undefined, {
          ...(code === 'method_not_allowed' ? { Allow: 'GET' } : {}),
        });
      });

      for (const [code, status] of Object.entries(statusByCode)) {
        const response = await app.request(`/boom/${code}`);
        expect(response.status, code).toBe(status);
        expect(await json(response), code).toMatchObject({ error: { code } });
      }
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('V1 API artifacts, versions, shares, and templates', () => {
  it('slug upsert keeps the same id and share URL while creating a new version', async () => {
    const ctx = await createApiTestContext();

    try {
      const firstResponse = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'stable-url', share: true })),
      });
      expect(firstResponse.status).toBe(201);
      const first = await json(firstResponse);

      const secondResponse = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(
          publishBody({
            slug: 'stable-url',
            type: 'html',
            content: '<p>converted</p>',
            share: true,
          })
        ),
      });
      expect(secondResponse.status).toBe(200);
      const second = await json(secondResponse);

      expect(second.id).toBe(first.id);
      expect(second.version_num).toBe(2);
      expect(second.type).toBe('html');
      expect(second.unchanged).toBe(false);
      expect((second.share as { url: string }).url).toBe((first.share as { url: string }).url);

      const unchangedResponse = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(
          publishBody({
            slug: 'stable-url',
            type: 'html',
            content: '<p>converted</p>',
            share: true,
          })
        ),
      });
      expect(unchangedResponse.status).toBe(200);
      expect(await json(unchangedResponse)).toMatchObject({
        id: first.id,
        version_num: 2,
        unchanged: true,
      });

      const readResponse = await ctx.app.request('/v1/artifacts/stable-url', {
        headers: ctx.authHeaders,
      });
      expect(readResponse.status).toBe(200);
      const read = await json(readResponse);
      expect(read).not.toHaveProperty('unchanged');
      expect(read.version_num).toBe(2);
    } finally {
      await ctx.cleanup();
    }
  });

  it('creates a share and stores an argon2 password hash in one publish call', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'protected', password: 'secret123' })),
      });
      expect(response.status).toBe(201);
      const body = await json(response);
      const share = body.share as { share_id: string; url: string; password_protected: boolean };
      expect(share.password_protected).toBe(true);
      expect(share.url).toBe(`${ctx.config.baseUrl}/a/${share.share_id}`);

      const row = ctx.db.sqlite
        .prepare('SELECT password_hash FROM shares WHERE id = ?')
        .get(share.share_id) as { password_hash: string };
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
    } finally {
      await ctx.cleanup();
    }
  });

  it('derives slugs from titles and rejects empty derivations', async () => {
    const ctx = await createApiTestContext();

    try {
      const derived = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ type: 'markdown', title: 'Hello, Agent World!', content: '# Hi' }),
      });
      expect(derived.status).toBe(201);
      expect(await json(derived)).toMatchObject({ slug: 'hello-agent-world' });

      const empty = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ type: 'markdown', title: '✨✨', content: '# Nope' }),
      });
      expect(empty.status).toBe(400);
      expect(await json(empty)).toMatchObject({
        error: {
          code: 'validation_failed',
          details: { field: 'slug', reason: 'cannot derive slug from title; provide slug' },
        },
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('round-trips opaque pagination cursors', async () => {
    const ctx = await createApiTestContext();

    try {
      for (const slug of ['page-one', 'page-two', 'page-three']) {
        const response = await ctx.app.request('/v1/artifacts', {
          method: 'POST',
          headers: { ...ctx.authHeaders, ...jsonContent },
          body: JSON.stringify(publishBody({ slug, title: slug, content: `# ${slug}` })),
        });
        expect(response.status).toBe(201);
      }

      const firstPageResponse = await ctx.app.request('/v1/artifacts?limit=2', {
        headers: ctx.authHeaders,
      });
      expect(firstPageResponse.status).toBe(200);
      const firstPage = await json(firstPageResponse);
      const firstItems = firstPage.items as Array<{ id: string }>;
      expect(firstItems).toHaveLength(2);
      expect(firstPage.next_cursor).toEqual(expect.any(String));

      const secondPageResponse = await ctx.app.request(
        `/v1/artifacts?limit=2&cursor=${encodeURIComponent(String(firstPage.next_cursor))}`,
        { headers: ctx.authHeaders }
      );
      expect(secondPageResponse.status).toBe(200);
      const secondPage = await json(secondPageResponse);
      const secondItems = secondPage.items as Array<{ id: string }>;
      expect(secondItems).toHaveLength(1);
      expect(secondPage.next_cursor).toBeNull();
      expect(new Set([...firstItems, ...secondItems].map((item) => item.id)).size).toBe(3);

      const clampedLimitResponse = await ctx.app.request('/v1/artifacts?limit=1000', {
        headers: ctx.authHeaders,
      });
      expect(clampedLimitResponse.status).toBe(200);
      expect((await json(clampedLimitResponse)).items as unknown[]).toHaveLength(3);
    } finally {
      await ctx.cleanup();
    }
  });

  it('lists, reads, and restores artifact versions', async () => {
    const ctx = await createApiTestContext();

    try {
      const created = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'versioned', content: '# v1' })),
      });
      expect(created.status).toBe(201);
      const updated = await ctx.app.request('/v1/artifacts/versioned', {
        method: 'PUT',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ content: '# v2', change_summary: 'second version' }),
      });
      expect(updated.status).toBe(200);

      const versionsResponse = await ctx.app.request('/v1/artifacts/versioned/versions', {
        headers: ctx.authHeaders,
      });
      expect(versionsResponse.status).toBe(200);
      const versions = await json(versionsResponse);
      expect(versions).toMatchObject({ current_version_num: 2, total: 2 });
      expect(versions.items as unknown[]).toHaveLength(2);
      expect(versions.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ version_num: 1, content_length: 4 })])
      );

      const versionOneResponse = await ctx.app.request('/v1/artifacts/versioned/versions/1', {
        headers: ctx.authHeaders,
      });
      expect(versionOneResponse.status).toBe(200);
      expect(versionOneResponse.headers.get('Cache-Control')).toBe(
        'private, max-age=86400, immutable'
      );
      expect(await json(versionOneResponse)).toMatchObject({ version_num: 1, content: '# v1' });

      const restoreResponse = await ctx.app.request('/v1/artifacts/versioned/versions/1/restore', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({}),
      });
      expect(restoreResponse.status).toBe(201);
      expect(await json(restoreResponse)).toMatchObject({
        version_num: 3,
        restored_from_version: 1,
        artifact: { version_num: 3 },
      });

      const currentRestore = await ctx.app.request('/v1/artifacts/versioned/versions/3/restore', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({}),
      });
      expect(currentRestore.status).toBe(400);
      expect(await json(currentRestore)).toMatchObject({
        error: { code: 'validation_failed', details: { reason: 'already_current' } },
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('creates, patches, revokes, and re-mints shares idempotently', async () => {
    const ctx = await createApiTestContext();

    try {
      const created = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'shareable' })),
      });
      expect(created.status).toBe(201);

      const firstShareResponse = await ctx.app.request('/v1/artifacts/shareable/share', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ password: 'secret123' }),
      });
      expect(firstShareResponse.status).toBe(201);
      const firstShare = await json(firstShareResponse);
      expect(firstShare).toMatchObject({ password_protected: true, reused: false });

      const reusedShareResponse = await ctx.app.request('/v1/artifacts/shareable/share', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({}),
      });
      expect(reusedShareResponse.status).toBe(200);
      const reusedShare = await json(reusedShareResponse);
      expect(reusedShare).toMatchObject({ share_id: firstShare.share_id, reused: true });

      const patchResponse = await ctx.app.request('/v1/artifacts/shareable/share', {
        method: 'PATCH',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ password: null }),
      });
      expect(patchResponse.status).toBe(200);
      expect(await json(patchResponse)).toMatchObject({ password_protected: false });

      const revokeResponse = await ctx.app.request('/v1/artifacts/shareable/share', {
        method: 'DELETE',
        headers: ctx.authHeaders,
      });
      expect(revokeResponse.status).toBe(200);
      expect(await json(revokeResponse)).toEqual({ revoked: true });

      const secondRevokeResponse = await ctx.app.request('/v1/artifacts/shareable/share', {
        method: 'DELETE',
        headers: ctx.authHeaders,
      });
      expect(secondRevokeResponse.status).toBe(200);
      expect(await json(secondRevokeResponse)).toEqual({ revoked: false });

      const reShareResponse = await ctx.app.request('/v1/artifacts/shareable/share', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({}),
      });
      expect(reShareResponse.status).toBe(201);
      const reShare = await json(reShareResponse);
      expect(reShare.share_id).not.toBe(firstShare.share_id);
      expect(reShare).toMatchObject({ views: { previous_shares: 1 } });
    } finally {
      await ctx.cleanup();
    }
  });

  it('soft-deletes artifacts idempotently and revokes the active share', async () => {
    const ctx = await createApiTestContext();

    try {
      const created = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'delete-me', share: true })),
      });
      expect(created.status).toBe(201);
      const body = await json(created);
      const share = body.share as { share_id: string };

      const deleted = await ctx.app.request('/v1/artifacts/delete-me', {
        method: 'DELETE',
        headers: ctx.authHeaders,
      });
      expect(deleted.status).toBe(200);
      expect(await json(deleted)).toMatchObject({ id: body.id, deleted: true });

      const shareRow = ctx.db.sqlite
        .prepare('SELECT revoked_at FROM shares WHERE id = ?')
        .get(share.share_id) as { revoked_at: number | null };
      expect(shareRow.revoked_at).toEqual(expect.any(Number));

      const secondDelete = await ctx.app.request('/v1/artifacts/delete-me', {
        method: 'DELETE',
        headers: ctx.authHeaders,
      });
      expect(secondDelete.status).toBe(200);
      expect(await json(secondDelete)).toMatchObject({
        id: body.id,
        deleted: true,
        already_deleted: true,
      });

      const readDeleted = await ctx.app.request('/v1/artifacts/delete-me', {
        headers: ctx.authHeaders,
      });
      expect(readDeleted.status).toBe(404);
    } finally {
      await ctx.cleanup();
    }
  });

  it('merges templates and reports template slot errors as validation_failed details', async () => {
    const ctx = await createApiTestContext();

    try {
      const templatesResponse = await ctx.app.request('/v1/templates', {
        headers: ctx.authHeaders,
      });
      expect(templatesResponse.status).toBe(200);
      const templates = await json(templatesResponse);
      expect(templates.items as unknown[]).toHaveLength(8);

      const reportResponse = await ctx.app.request('/v1/templates/report', {
        headers: ctx.authHeaders,
      });
      expect(reportResponse.status).toBe(200);
      expect(await json(reportResponse)).toMatchObject({
        slug: 'report',
        built_in: true,
        thumbnail_url: '/assets/template-thumbs/report.png',
        type: 'markdown',
      });

      const merged = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'templated-report',
          title: 'Templated Report',
          template: 'report',
          slots: {
            title: 'Templated Report',
            date: '2026-08-26',
            summary: 'Summary',
            body: 'Body',
            next_steps: 'Next',
          },
        }),
      });
      expect(merged.status).toBe(201);
      expect(await json(merged)).toMatchObject({
        type: 'markdown',
        content: expect.stringContaining('Body'),
      });

      const missing = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'missing-slots',
          title: 'Missing',
          template: 'report',
          slots: {},
        }),
      });
      expect(missing.status).toBe(400);
      expect(await json(missing)).toMatchObject({
        error: {
          code: 'validation_failed',
          details: {
            missing_slots: expect.arrayContaining(['title']),
            valid_slots: expect.any(Array),
          },
        },
      });

      const unknownSlot = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'unknown-slot',
          title: 'Unknown',
          template: 'report',
          slots: {
            title: 'Unknown',
            date: '2026-08-26',
            summary: 'Summary',
            body: 'Body',
            next_steps: 'Next',
            surprise: 'Nope',
          },
        }),
      });
      expect(unknownSlot.status).toBe(400);
      expect(await json(unknownSlot)).toMatchObject({
        error: {
          code: 'validation_failed',
          details: { unknown_slots: ['surprise'], valid_slots: expect.any(Array) },
        },
      });

      const unknownTemplate = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ slug: 'unknown-template', title: 'Unknown', template: 'missing' }),
      });
      expect(unknownTemplate.status).toBe(400);
      expect(await json(unknownTemplate)).toMatchObject({
        error: { code: 'validation_failed', details: { unknown_template: 'missing' } },
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('downloads the current artifact content with type-specific headers', async () => {
    const ctx = await createApiTestContext();

    try {
      const created = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify(publishBody({ slug: 'download-me', content: '# Download me' })),
      });
      expect(created.status).toBe(201);

      const response = await ctx.app.request('/v1/artifacts/download-me/download', {
        headers: ctx.authHeaders,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
      expect(response.headers.get('Content-Disposition')).toBe(
        'attachment; filename="download-me.md"'
      );
      expect(await response.text()).toBe('# Download me');
    } finally {
      await ctx.cleanup();
    }
  });
});
