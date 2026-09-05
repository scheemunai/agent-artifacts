import { nanoid } from 'nanoid';
import { describe, expect, it } from 'vitest';
import type { Account } from '../../src/extension/cloud-module.js';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';
import { createBot } from '../../src/services/bots.js';
import { loadStarterTemplates } from '../../src/services/templates.js';
import {
  type ApiTestContext,
  createApiTestContext,
  insertAccount,
  json,
} from './api-test-utils.js';

const jsonContent = { 'Content-Type': 'application/json' };

async function publishSource(ctx: ApiTestContext, slug: string): Promise<string> {
  const response = await ctx.app.request('/v1/artifacts', {
    method: 'POST',
    headers: { ...ctx.authHeaders, ...jsonContent },
    body: JSON.stringify({
      slug,
      type: 'markdown',
      title: `Source ${slug}`,
      content: `# Source ${slug}\n\nBody.`,
    }),
  });
  expect(response.status).toBe(201);
  return (await json(response)).id as string;
}

/** A second account with its own bot key, for the "not yours" half of the delete contract. */
async function secondAccountHeaders(ctx: ApiTestContext): Promise<Record<string, string>> {
  const account: Account = {
    id: `acc_${nanoid(21)}`,
    email: `other-${nanoid(8)}@example.test`,
    suspendedAt: null,
  };
  insertAccount(ctx.db, account);
  const bot = await createBot({
    db: ctx.db,
    extension: createDefaultCloudModule(ctx.config),
    account,
    name: 'Other Bot',
    byline: 'Other account bot',
  });
  return { Authorization: `Bearer ${bot.apiKey}` };
}

describe('built-in template slugs are reserved', () => {
  it('refuses to create an account template that shadows a built-in slug', async () => {
    const ctx = await createApiTestContext();

    try {
      const artifactId = await publishSource(ctx, 'shadow-source');

      const response = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: artifactId,
          slug: 'report',
          name: 'My Report',
        }),
      });

      expect(response.status).toBe(409);
      expect(await json(response)).toMatchObject({
        error: {
          code: 'slug_conflict',
          details: { field: 'slug', slug: 'report', built_in: true },
        },
      });

      // The built-in is untouched: still built-in, still declaring its five slots.
      const detail = await ctx.app.request('/v1/templates/report', { headers: ctx.authHeaders });
      expect(detail.status).toBe(200);
      const template = await json(detail);
      expect(template).toMatchObject({ slug: 'report', built_in: true });
      expect((template.slots as unknown[]).length).toBe(5);
    } finally {
      await ctx.cleanup();
    }
  });

  it('reserves every built-in slug, not just report', async () => {
    const ctx = await createApiTestContext();

    try {
      const artifactId = await publishSource(ctx, 'reservation-source');
      // The point of this test is that reservation covers the WHOLE built-in lineup, so the list
      // has to come from the lineup. A hand-copied array silently stops covering the newest
      // template the day someone adds one — which is exactly the gap this test exists to close.
      const builtInSlugs = loadStarterTemplates().map((template) => template.slug);
      expect(builtInSlugs.length).toBeGreaterThan(1);

      for (const slug of builtInSlugs) {
        const response = await ctx.app.request('/v1/templates', {
          method: 'POST',
          headers: { ...ctx.authHeaders, ...jsonContent },
          body: JSON.stringify({ artifact_id: artifactId, slug, name: `Shadow ${slug}` }),
        });
        expect(response.status, `expected 409 for built-in slug ${slug}`).toBe(409);
        expect(await json(response)).toMatchObject({
          error: { code: 'slug_conflict', details: { built_in: true, slug } },
        });
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('still reports an unknown artifact_id as 404 before it reports the slug as taken', async () => {
    const ctx = await createApiTestContext();

    try {
      // The reservation moved this check earlier in the function; the order errors are reported in
      // is part of the contract, so a caller who got both wrong hears about the artifact first.
      const response = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: 'art_aaaaaaaaaaaaaaaaaaaaa',
          slug: 'report',
          name: 'Neither of these exists',
        }),
      });

      expect(response.status).toBe(404);
      expect(await json(response)).toMatchObject({ error: { code: 'not_found' } });
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps template publishing unambiguous: report still merges slots after a refused shadow', async () => {
    const ctx = await createApiTestContext();

    try {
      const artifactId = await publishSource(ctx, 'ambiguity-source');
      const shadow = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ artifact_id: artifactId, slug: 'report', name: 'Shadow Report' }),
      });
      expect(shadow.status).toBe(409);

      // The bug this closes: with a slot-free shadow in place, this answered 201 with the shadow's
      // content and dropped every slot in silence.
      const publish = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'uses-report',
          title: 'Week 35',
          template: 'report',
          slots: {
            title: 'Week 35',
            date: '2026-08-30',
            summary: 'Reserved built-in slugs.',
            body: '## Highlights\n\n- Shadowing is refused.',
            next_steps: '- Deploy.',
          },
        }),
      });
      expect(publish.status).toBe(201);
      const body = await json(publish);
      expect(body.content).toContain('Reserved built-in slugs.');
      expect(body.content).toContain('- Shadowing is refused.');
      expect(body.content).not.toMatch(/\{\{[a-z0-9_]+\}\}/);
    } finally {
      await ctx.cleanup();
    }
  });

  it('still refuses a slug the account already uses, and names it in the details', async () => {
    const ctx = await createApiTestContext();

    try {
      const artifactId = await publishSource(ctx, 'account-slug-source');
      const first = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ artifact_id: artifactId, slug: 'ops-brief', name: 'Ops Brief' }),
      });
      expect(first.status).toBe(201);

      const second = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ artifact_id: artifactId, slug: 'ops-brief', name: 'Ops Brief 2' }),
      });
      expect(second.status).toBe(409);
      const conflict = await json(second);
      expect(conflict).toMatchObject({
        error: { code: 'slug_conflict', details: { field: 'slug', slug: 'ops-brief' } },
      });
      // An account collision is not a reservation, and must not claim to be one.
      expect((conflict.error as { details: Record<string, unknown> }).details.built_in).toBe(
        undefined
      );
    } finally {
      await ctx.cleanup();
    }
  });
});

describe('DELETE /v1/templates/:slug', () => {
  it('deletes the account template, leaves published artifacts alone, and frees the slug', async () => {
    const ctx = await createApiTestContext();

    try {
      const artifactId = await publishSource(ctx, 'delete-source');
      const created = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ artifact_id: artifactId, slug: 'throwaway', name: 'Throwaway' }),
      });
      expect(created.status).toBe(201);
      const templateId = (await json(created)).id as string;

      const published = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'from-throwaway',
          title: 'From throwaway',
          template: 'throwaway',
        }),
      });
      expect(published.status).toBe(201);

      const deleted = await ctx.app.request('/v1/templates/throwaway', {
        method: 'DELETE',
        headers: ctx.authHeaders,
      });
      expect(deleted.status).toBe(200);
      expect(await json(deleted)).toEqual({
        deleted: true,
        id: templateId,
        slug: 'throwaway',
      });

      const gone = await ctx.app.request('/v1/templates/throwaway', { headers: ctx.authHeaders });
      expect(gone.status).toBe(404);

      const list = await ctx.app.request('/v1/templates?limit=50', { headers: ctx.authHeaders });
      const items = (await json(list)).items as Array<{ slug: string }>;
      expect(items.map((item) => item.slug)).not.toContain('throwaway');

      // The artifact published from it survives its template.
      const artifact = await ctx.app.request('/v1/artifacts/from-throwaway', {
        headers: ctx.authHeaders,
      });
      expect(artifact.status).toBe(200);

      // And the slug is reusable, which is what makes a bad promote recoverable.
      const again = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ artifact_id: artifactId, slug: 'throwaway', name: 'Throwaway 2' }),
      });
      expect(again.status).toBe(201);
    } finally {
      await ctx.cleanup();
    }
  });

  it('refuses to delete a built-in with 403 built_in_template and leaves it usable', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/templates/report', {
        method: 'DELETE',
        headers: ctx.authHeaders,
      });
      expect(response.status).toBe(403);
      expect(await json(response)).toMatchObject({
        error: {
          code: 'built_in_template',
          details: { field: 'slug', slug: 'report', built_in: true },
        },
      });

      const detail = await ctx.app.request('/v1/templates/report', { headers: ctx.authHeaders });
      expect(detail.status).toBe(200);
      expect(await json(detail)).toMatchObject({ slug: 'report', built_in: true });
    } finally {
      await ctx.cleanup();
    }
  });

  it('answers 404 for an unknown slug and for another account template', async () => {
    const ctx = await createApiTestContext();

    try {
      const unknown = await ctx.app.request('/v1/templates/never-existed', {
        method: 'DELETE',
        headers: ctx.authHeaders,
      });
      expect(unknown.status).toBe(404);
      expect(await json(unknown)).toMatchObject({ error: { code: 'not_found' } });

      const artifactId = await publishSource(ctx, 'isolation-source');
      const created = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ artifact_id: artifactId, slug: 'mine-only', name: 'Mine only' }),
      });
      expect(created.status).toBe(201);

      const otherHeaders = await secondAccountHeaders(ctx);
      const crossAccount = await ctx.app.request('/v1/templates/mine-only', {
        method: 'DELETE',
        headers: otherHeaders,
      });
      expect(crossAccount.status).toBe(404);

      // Still there for its owner.
      const stillMine = await ctx.app.request('/v1/templates/mine-only', {
        headers: ctx.authHeaders,
      });
      expect(stillMine.status).toBe(200);
    } finally {
      await ctx.cleanup();
    }
  });

  it('requires authentication and advertises DELETE in the Allow header', async () => {
    const ctx = await createApiTestContext();

    try {
      const unauthenticated = await ctx.app.request('/v1/templates/report', { method: 'DELETE' });
      expect(unauthenticated.status).toBe(401);

      const wrongMethod = await ctx.app.request('/v1/templates/report', {
        method: 'PUT',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: '{}',
      });
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get('Allow')).toBe('GET, DELETE');
    } finally {
      await ctx.cleanup();
    }
  });
});
