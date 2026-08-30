import { describe, expect, it } from 'vitest';
import { createApiTestContext } from './api-test-utils.js';

const jsonContent = { 'Content-Type': 'application/json' };

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: { field?: string; issues?: Array<{ field: string; message: string }> };
  };
}

describe('validation_failed names the key it rejected', () => {
  it('populates details.field and issues[].field when a publish body carries an unknown key', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'unknown-key',
          type: 'markdown',
          title: 'Unknown key',
          content: '# Unknown key',
          expires_at: null,
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorBody;
      expect(body.error.code).toBe('validation_failed');
      // A strict-object rejection has no path — the offending key is not AT a path, it is the
      // thing that should not exist — so reading the name off the path alone left this empty.
      expect(body.error.details.field).toBe('expires_at');
      expect(body.error.details.issues).toEqual([
        { field: 'expires_at', message: expect.any(String) },
      ]);
    } finally {
      await ctx.cleanup();
    }
  });

  it('names every rejected key when a body carries several', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts/anything', {
        method: 'PUT',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ title: 'Fine', share: true, password: 'nope' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorBody;
      expect(body.error.details.field).toBe('share, password');
      expect(body.error.details.issues?.[0]?.field).toBe('share, password');
    } finally {
      await ctx.cleanup();
    }
  });

  it('still names the field for ordinary per-field failures', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({ slug: 'Not A Slug', type: 'markdown', title: 'T', content: '# T' }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorBody;
      expect(body.error.details.field).toBe('slug');
      expect(body.error.details.issues?.[0]?.field).toBe('slug');
    } finally {
      await ctx.cleanup();
    }
  });

  it('names the field on a rejected template promotion too', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: 'art_abcdefghijklmnopqrstu',
          slug: 'ops-brief',
          name: 'Ops Brief',
          content: 'not a promote field',
        }),
      });

      expect(response.status).toBe(400);
      const body = (await response.json()) as ErrorBody;
      expect(body.error.details.field).toBe('content');
      expect(body.error.details.issues?.[0]?.field).toBe('content');
    } finally {
      await ctx.cleanup();
    }
  });
});
