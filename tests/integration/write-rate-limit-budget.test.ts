import { describe, expect, it } from 'vitest';
import { createApiTestContext, json } from './api-test-utils.js';

const jsonContent = { 'Content-Type': 'application/json' };

/** The default write budget (`AA_RATE_LIMIT_WRITES_PER_MIN`). */
const WRITE_LIMIT = 10;

describe('the write rate limit prices writes, not attempts', () => {
  it('does not charge a rejected write, so a typo cannot cost an agent its publishes', async () => {
    const ctx = await createApiTestContext({ rateLimitsDisabled: false });

    try {
      // Twelve refused writes: more than the whole write budget, none of which wrote anything.
      for (let index = 0; index < 12; index += 1) {
        const invalid = await ctx.app.request('/v1/artifacts', {
          method: 'POST',
          headers: { ...ctx.authHeaders, ...jsonContent },
          body: JSON.stringify({ title: 'No type and no content' }),
        });
        expect(invalid.status).toBe(400);
        expect(invalid.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT));
      }

      // The budget is untouched, so the next real write goes through.
      const published = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'survives-the-typos',
          type: 'markdown',
          title: 'Survives the typos',
          content: '# Survives',
        }),
      });
      expect(published.status).toBe(201);
      expect(published.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT - 1));
    } finally {
      await ctx.cleanup();
    }
  });

  it('refunds every 4xx a write can produce — 404, 409, 413 — but never a 2xx', async () => {
    const ctx = await createApiTestContext({ rateLimitsDisabled: false, maxContentBytes: 64 });

    try {
      const created = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'budget-probe',
          type: 'markdown',
          title: 'Budget probe',
          content: '# Probe',
        }),
      });
      expect(created.status).toBe(201);
      const artifactId = (await json(created)).id as string;
      expect(created.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT - 1));

      const missing = await ctx.app.request('/v1/artifacts/does-not-exist', {
        method: 'DELETE',
        headers: ctx.authHeaders,
      });
      expect(missing.status).toBe(404);
      expect(missing.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT - 1));

      const conflict = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ artifact_id: artifactId, slug: 'report', name: 'Shadow' }),
      });
      expect(conflict.status).toBe(409);
      expect(conflict.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT - 1));

      const tooLarge = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'too-large',
          type: 'markdown',
          title: 'Too large',
          content: '#'.repeat(256),
        }),
      });
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT - 1));

      // One successful write, one token: the budget still moves when work is actually done.
      const second = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'budget-probe-2',
          type: 'markdown',
          title: 'Second',
          content: '# Second',
        }),
      });
      expect(second.status).toBe(201);
      expect(second.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT - 2));
    } finally {
      await ctx.cleanup();
    }
  });

  it('still stops a run of successful writes at the cap, with Retry-After and details.retry_after', async () => {
    const ctx = await createApiTestContext({ rateLimitsDisabled: false });

    try {
      for (let index = 0; index < WRITE_LIMIT; index += 1) {
        const allowed = await ctx.app.request('/v1/artifacts', {
          method: 'POST',
          headers: { ...ctx.authHeaders, ...jsonContent },
          body: JSON.stringify({
            slug: `capped-${index}`,
            type: 'markdown',
            title: `Capped ${index}`,
            content: `# Capped ${index}`,
          }),
        });
        expect(allowed.status).toBe(201);
      }

      const overLimit = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'capped-last',
          type: 'markdown',
          title: 'Capped last',
          content: '# Capped last',
        }),
      });
      expect(overLimit.status).toBe(429);
      expect(overLimit.headers.get('Retry-After')).toMatch(/^\d+$/);
      expect(await json(overLimit)).toMatchObject({
        error: {
          code: 'rate_limited',
          details: { limit: WRITE_LIMIT, retry_after: expect.any(Number) },
        },
      });

      // A refused request keeps its token: the 429 must not refund itself into a free retry.
      const stillLimited = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'capped-last',
          type: 'markdown',
          title: 'Capped last',
          content: '# Capped last',
        }),
      });
      expect(stillLimited.status).toBe(429);
    } finally {
      await ctx.cleanup();
    }
  });

  it('charges a collection write exactly once, not once per matching route pattern', async () => {
    const ctx = await createApiTestContext({ rateLimitsDisabled: false });

    try {
      // `POST /v1/artifacts` matches both the `/artifacts` and the `/artifacts/*` middleware
      // registrations. When the budget was taken on each, publishing cost two tokens and the
      // documented 10 writes/min was really 5 — on the one endpoint agents use most.
      const collectionWrite = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'charged-once',
          type: 'markdown',
          title: 'Charged once',
          content: '# Charged once',
        }),
      });
      expect(collectionWrite.status).toBe(201);
      expect(collectionWrite.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT - 1));

      // An item write matched only one registration all along; both must now agree.
      const itemWrite = await ctx.app.request('/v1/artifacts/charged-once', {
        method: 'PUT',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ title: 'Charged once, renamed' }),
      });
      expect(itemWrite.status).toBe(200);
      expect(itemWrite.headers.get('X-RateLimit-Remaining')).toBe(String(WRITE_LIMIT - 2));

      const collectionRead = await ctx.app.request('/v1/artifacts', { headers: ctx.authHeaders });
      expect(collectionRead.status).toBe(200);
      // Three requests so far, three tokens off the 60/min request budget.
      expect(collectionRead.headers.get('X-RateLimit-Limit')).toBe('60');
      expect(collectionRead.headers.get('X-RateLimit-Remaining')).toBe('57');
    } finally {
      await ctx.cleanup();
    }
  });

  it('leaves reads charging the request budget as before', async () => {
    const ctx = await createApiTestContext({ rateLimitsDisabled: false, rateLimitRpm: 3 });

    try {
      for (let index = 0; index < 3; index += 1) {
        const allowed = await ctx.app.request('/v1/artifacts', { headers: ctx.authHeaders });
        expect(allowed.status).toBe(200);
      }

      const overLimit = await ctx.app.request('/v1/artifacts', { headers: ctx.authHeaders });
      expect(overLimit.status).toBe(429);
    } finally {
      await ctx.cleanup();
    }
  });
});
