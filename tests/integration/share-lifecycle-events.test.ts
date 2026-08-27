import { afterEach, describe, expect, it } from 'vitest';
import type { ArtifactEvent, CloudModule } from '../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { AuthService, accountToCloudAccount } from '../../src/services/auth.js';
import {
  createPostgresTestContext,
  POSTGRES_TEST_NOW,
  postgresArtifactService,
  postgresCountRows,
  publishPostgresArtifact,
} from '../support/postgres-harness.js';
import { type ApiTestContext, createApiTestContext, json } from './api-test-utils.js';
import {
  type AuthTestContext,
  createAuthTestContext,
  formBody,
  login,
  originHeaders,
} from './auth-test-utils.js';

const jsonContent = { 'Content-Type': 'application/json' };

interface EventRecorder {
  cloudModule: CloudModule;
  events: ArtifactEvent[];
  drain(): ArtifactEvent[];
  ofType(type: ArtifactEvent['type']): ArtifactEvent[];
}

function recordingCloudModule(base: CloudModule): EventRecorder {
  const events: ArtifactEvent[] = [];
  return {
    cloudModule: {
      ...base,
      onArtifactEvent(event) {
        events.push(event);
      },
    },
    events,
    drain() {
      return events.splice(0, events.length);
    },
    ofType(type) {
      return events.filter((event) => event.type === type);
    },
  };
}

function publishBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    slug: 'share-events',
    type: 'markdown',
    title: 'Share Events',
    content: '# Share events',
    ...overrides,
  });
}

let apiContexts: ApiTestContext[] = [];
let authContexts: AuthTestContext[] = [];

afterEach(async () => {
  await Promise.all([
    ...apiContexts.map((ctx) => ctx.cleanup()),
    ...authContexts.map((ctx) => ctx.cleanup()),
  ]);
  apiContexts = [];
  authContexts = [];
});

async function makeApiContext(recorder: EventRecorder): Promise<ApiTestContext> {
  const ctx = await createApiTestContext({ cloudModule: recorder.cloudModule });
  apiContexts.push(ctx);
  return ctx;
}

async function makeAuthContext(recorder: EventRecorder): Promise<AuthTestContext> {
  const ctx = await createAuthTestContext({}, { cloudModule: recorder.cloudModule });
  authContexts.push(ctx);
  return ctx;
}

/**
 * R2-001 / PRD §4.5: `share.created` and `share.revoked` are part of the closed CloudModule
 * hook surface for analytics and metering. Every share mutation path must emit through the
 * service, exactly once, with the correct payload. These tests are the regression net for the
 * seam that previously let the explicit /v1 endpoints and the dashboard write shares silently.
 */
describe('share lifecycle events reach the CloudModule hook', () => {
  it('emits share.created exactly once for an explicit POST /v1 share', async () => {
    const recorder = recordingCloudModule(createDefaultCloudModule({ aaHideFooter: false }));
    const ctx = await makeApiContext(recorder);

    const created = await ctx.app.request('/v1/artifacts', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: publishBody(),
    });
    expect(created.status).toBe(201);
    const artifactId = (await json(created)).id as string;
    recorder.drain();

    const shared = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: JSON.stringify({}),
    });
    expect(shared.status).toBe(201);
    const shareId = (await json(shared)).share_id as string;

    expect(recorder.events).toEqual([
      {
        type: 'share.created',
        accountId: ctx.account.id,
        artifactId,
        shareId,
        at: expect.any(String),
      },
    ]);
    expect(Date.parse(String(recorder.events[0]?.at))).not.toBeNaN();
  });

  it('emits share.created exactly once when the share carries a password', async () => {
    const recorder = recordingCloudModule(createDefaultCloudModule({ aaHideFooter: false }));
    const ctx = await makeApiContext(recorder);

    await ctx.app.request('/v1/artifacts', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: publishBody(),
    });
    recorder.drain();

    const shared = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: JSON.stringify({ password: 'secret123' }),
    });
    expect(shared.status).toBe(201);

    expect(recorder.ofType('share.created')).toHaveLength(1);
  });

  it('does not re-emit share.created when an existing share is reused', async () => {
    const recorder = recordingCloudModule(createDefaultCloudModule({ aaHideFooter: false }));
    const ctx = await makeApiContext(recorder);

    await ctx.app.request('/v1/artifacts', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: publishBody(),
    });
    await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: JSON.stringify({}),
    });
    recorder.drain();

    const reused = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: JSON.stringify({}),
    });
    expect(reused.status).toBe(200);
    expect(await json(reused)).toMatchObject({ reused: true });
    expect(recorder.events).toEqual([]);
  });

  it('emits nothing for PATCH share password changes', async () => {
    const recorder = recordingCloudModule(createDefaultCloudModule({ aaHideFooter: false }));
    const ctx = await makeApiContext(recorder);

    await ctx.app.request('/v1/artifacts', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: publishBody(),
    });
    await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: JSON.stringify({ password: 'secret123' }),
    });
    recorder.drain();

    const patched = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'PATCH',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: JSON.stringify({ password: null }),
    });
    expect(patched.status).toBe(200);
    expect(recorder.events).toEqual([]);
  });

  it('emits share.revoked exactly once for DELETE /v1 share, and nothing on the second call', async () => {
    const recorder = recordingCloudModule(createDefaultCloudModule({ aaHideFooter: false }));
    const ctx = await makeApiContext(recorder);

    const created = await ctx.app.request('/v1/artifacts', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: publishBody(),
    });
    const artifactId = (await json(created)).id as string;
    const shared = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: JSON.stringify({}),
    });
    const shareId = (await json(shared)).share_id as string;
    recorder.drain();

    const revoked = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'DELETE',
      headers: ctx.authHeaders,
    });
    expect(revoked.status).toBe(200);
    expect(await json(revoked)).toEqual({ revoked: true });
    expect(recorder.drain()).toEqual([
      {
        type: 'share.revoked',
        accountId: ctx.account.id,
        artifactId,
        shareId,
        at: expect.any(String),
      },
    ]);

    const revokedAgain = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'DELETE',
      headers: ctx.authHeaders,
    });
    expect(revokedAgain.status).toBe(200);
    expect(await json(revokedAgain)).toEqual({ revoked: false });
    expect(recorder.events).toEqual([]);
  });

  it('emits share.created exactly once for an upsert-implied share', async () => {
    const recorder = recordingCloudModule(createDefaultCloudModule({ aaHideFooter: false }));
    const ctx = await makeApiContext(recorder);

    const created = await ctx.app.request('/v1/artifacts', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: publishBody({ share: true }),
    });
    expect(created.status).toBe(201);
    const body = await json(created);
    const share = body.share as { share_id: string };

    expect(recorder.ofType('share.created')).toEqual([
      {
        type: 'share.created',
        accountId: ctx.account.id,
        artifactId: body.id,
        shareId: share.share_id,
        at: expect.any(String),
      },
    ]);
  });

  it('emits share.revoked exactly once when the artifact is soft-deleted', async () => {
    const recorder = recordingCloudModule(createDefaultCloudModule({ aaHideFooter: false }));
    const ctx = await makeApiContext(recorder);

    const created = await ctx.app.request('/v1/artifacts', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: publishBody({ share: true }),
    });
    const body = await json(created);
    const share = body.share as { share_id: string };
    recorder.drain();

    const deleted = await ctx.app.request('/v1/artifacts/share-events', {
      method: 'DELETE',
      headers: ctx.authHeaders,
    });
    expect(deleted.status).toBe(200);

    expect(recorder.ofType('share.revoked')).toEqual([
      {
        type: 'share.revoked',
        accountId: ctx.account.id,
        artifactId: body.id,
        shareId: share.share_id,
        at: expect.any(String),
      },
    ]);
    expect(recorder.ofType('artifact.deleted')).toHaveLength(1);
  });

  it('emits share.created and share.revoked exactly once for dashboard share mutations', async () => {
    const recorder = recordingCloudModule(createDefaultCloudModule({ aaHideFooter: false }));
    const ctx = await makeAuthContext(recorder);

    const auth = new AuthService(ctx.db, ctx.config, ctx.logger);
    const account = await auth.createPasswordAccount('dash@example.test', 'password123');
    const cloudAccount = accountToCloudAccount(account);
    const artifacts = new ArtifactService({
      db: ctx.db,
      extension: recorder.cloudModule,
      baseUrl: ctx.config.baseUrl,
    });
    const created = await artifacts.upsertArtifact({
      account: cloudAccount,
      slug: 'dash-share-events',
      type: 'markdown',
      title: 'Dash Share Events',
      content: '# Dash',
      share: false,
    });
    const cookie = await login(ctx, account.email, 'password123');
    const headers = originHeaders(ctx, cookie);
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    recorder.drain();

    const shareCreated = await ctx.app.request(
      `/dashboard/api/artifacts/${created.artifact.id}/share`,
      { method: 'POST', headers, body: formBody({ password: 'secret-pass' }).body }
    );
    expect(shareCreated.status).toBe(303);

    const shareRow = ctx.db.sqlite
      .prepare('SELECT id FROM shares WHERE artifact_id = ? AND revoked_at IS NULL')
      .get(created.artifact.id) as { id: string };
    expect(recorder.drain()).toEqual([
      {
        type: 'share.created',
        accountId: account.id,
        artifactId: created.artifact.id,
        shareId: shareRow.id,
        at: expect.any(String),
      },
    ]);

    const passwordChanged = await ctx.app.request(
      `/dashboard/api/artifacts/${created.artifact.id}/share/password`,
      { method: 'POST', headers, body: formBody({ password: 'another-pass' }).body }
    );
    expect(passwordChanged.status).toBe(303);
    const passwordRemoved = await ctx.app.request(
      `/dashboard/api/artifacts/${created.artifact.id}/share/password/remove`,
      { method: 'POST', headers, body: formBody({}).body }
    );
    expect(passwordRemoved.status).toBe(303);
    expect(recorder.events).toEqual([]);

    const revoked = await ctx.app.request(
      `/dashboard/api/artifacts/${created.artifact.id}/share/revoke`,
      { method: 'POST', headers, body: formBody({ confirm: 'dash-share-events' }).body }
    );
    expect(revoked.status).toBe(303);
    expect(recorder.drain()).toEqual([
      {
        type: 'share.revoked',
        accountId: account.id,
        artifactId: created.artifact.id,
        shareId: shareRow.id,
        at: expect.any(String),
      },
    ]);
  });

  it('survives a throwing onArtifactEvent consumer without failing the share mutation', async () => {
    const cloudModule: CloudModule = {
      ...createDefaultCloudModule({ aaHideFooter: false }),
      onArtifactEvent() {
        throw new Error('consumer exploded');
      },
    };
    const ctx = await createApiTestContext({ cloudModule });
    apiContexts.push(ctx);

    await ctx.app.request('/v1/artifacts', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: publishBody(),
    });
    const shared = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'POST',
      headers: { ...ctx.authHeaders, ...jsonContent },
      body: JSON.stringify({}),
    });
    expect(shared.status).toBe(201);

    const revoked = await ctx.app.request('/v1/artifacts/share-events/share', {
      method: 'DELETE',
      headers: ctx.authHeaders,
    });
    expect(revoked.status).toBe(200);
    expect(await json(revoked)).toEqual({ revoked: true });
  });
});

const describePostgres = process.env.AA_TEST_DATABASE_URL ? describe : describe.skip;

describePostgres('share lifecycle events on PostgreSQL', () => {
  it('revokes the active share transactionally and emits share.revoked once', async () => {
    const events: ArtifactEvent[] = [];
    const ctx = await createPostgresTestContext({
      cloudModule: {
        ...createDefaultCloudModule({ aaHideFooter: false }),
        onArtifactEvent(event) {
          events.push(event);
        },
      },
    });

    try {
      const artifact = await publishPostgresArtifact(ctx, {
        slug: 'pg-share-revoke-events',
        now: POSTGRES_TEST_NOW,
        share: true,
      });
      const shareId = artifact.share?.shareId;
      expect(shareId).toEqual(expect.any(String));
      events.splice(0, events.length);

      const service = postgresArtifactService(ctx, POSTGRES_TEST_NOW);
      const result = await service.revokeShare({
        account: ctx.account,
        idOrSlug: artifact.artifact.slug,
      });

      expect(result).toEqual({ revoked: true, revokedShareIds: [shareId] });
      expect(events).toEqual([
        {
          type: 'share.revoked',
          accountId: ctx.account.id,
          artifactId: artifact.artifact.id,
          shareId,
          at: new Date(POSTGRES_TEST_NOW).toISOString(),
        },
      ]);
      expect(
        await postgresCountRows(ctx, 'shares', 'artifact_id = $1 AND revoked_at IS NULL', [
          artifact.artifact.id,
        ])
      ).toBe(0);

      events.splice(0, events.length);
      const second = await service.revokeShare({
        account: ctx.account,
        idOrSlug: artifact.artifact.slug,
      });
      expect(second).toEqual({ revoked: false, revokedShareIds: [] });
      expect(events).toEqual([]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('reads a built-in template preview through the service on PostgreSQL', async () => {
    const ctx = await createPostgresTestContext();

    try {
      const seeded = await ctx.db.pool.query<{ id: string; slug: string }>(
        'SELECT id, slug FROM templates WHERE account_id IS NULL ORDER BY slug LIMIT 1'
      );
      const template = seeded.rows[0];
      expect(template).toBeDefined();

      const service = postgresArtifactService(ctx, POSTGRES_TEST_NOW);
      const preview = await service.getTemplatePreview(ctx.account.id, template?.id ?? '');

      expect(preview).toMatchObject({
        id: template?.id,
        slug: template?.slug,
        builtIn: true,
      });
      expect(preview?.content).toEqual(expect.any(String));
      expect(Array.isArray(preview?.slots)).toBe(true);
      await expect(service.getTemplatePreview(ctx.account.id, '')).resolves.toBeNull();
      await expect(
        service.getTemplatePreview(ctx.account.id, 'tpl_does_not_exist')
      ).resolves.toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
