import { describe, expect, it } from 'vitest';
import { createApiTestContext, json } from './api-test-utils.js';

const jsonContent = { 'Content-Type': 'application/json' };

describe('template API and promote flow', () => {
  it('publishes with the report template and returns merged content with share.url', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'weekly-template-report',
          title: 'Week 34',
          template: 'report',
          slots: {
            title: 'Week 34',
            date: '2026-08-25',
            summary: 'Shipped v2.1 and resolved queue drift.',
            body: '## Highlights\n\n- Merged templates server-side.',
            next_steps: '- Ship dashboard template controls.',
          },
          share: true,
        }),
      });
      expect(response.status).toBe(201);
      const body = await json(response);
      expect(body).toMatchObject({
        slug: 'weekly-template-report',
        type: 'markdown',
        title: 'Week 34',
        share: { url: `${ctx.config.baseUrl}/a/${(body.share as { share_id: string }).share_id}` },
      });
      expect(body.content).toContain('> Shipped v2.1 and resolved queue drift.');
      expect(body.content).toContain('## Body\n\n## Highlights');
      expect(body.content).toContain('## Next steps\n\n- Ship dashboard template controls.');
      expect(body.content).not.toMatch(/\{\{[a-z0-9_]+\}\}/);
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns validation_failed details for missing slots, unknown slots, and unknown templates', async () => {
    const ctx = await createApiTestContext();

    try {
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
            missing_slots: ['title', 'date', 'summary', 'body', 'next_steps'],
            valid_slots: ['title', 'date', 'summary', 'body', 'next_steps'],
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
            date: '2026-08-25',
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
          details: {
            unknown_slots: ['surprise'],
            valid_slots: ['title', 'date', 'summary', 'body', 'next_steps'],
          },
        },
      });

      const unknownTemplate = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'unknown-template',
          title: 'Unknown',
          template: 'does-not-exist',
          slots: {},
        }),
      });
      expect(unknownTemplate.status).toBe(400);
      expect(await json(unknownTemplate)).toMatchObject({
        error: {
          code: 'validation_failed',
          details: { unknown_template: 'does-not-exist' },
        },
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('promotes a markdown artifact to an account template and makes it immediately usable', async () => {
    const ctx = await createApiTestContext();

    try {
      const source = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'promotion-source',
          type: 'markdown',
          title: 'Promotion Source',
          content: '# {{title}}\n\nIntro: {{body}}\n\nAgain: {{body}}',
        }),
      });
      expect(source.status).toBe(201);
      const sourceBody = await json(source);

      const promoted = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: sourceBody.id,
          slug: 'promoted-weekly',
          name: 'Promoted Weekly',
          description: 'Promoted from an artifact.',
        }),
      });
      expect(promoted.status).toBe(201);
      expect(await json(promoted)).toMatchObject({
        slug: 'promoted-weekly',
        name: 'Promoted Weekly',
        description: 'Promoted from an artifact.',
        built_in: false,
        content: '# {{title}}\n\nIntro: {{body}}\n\nAgain: {{body}}',
        slots: [
          { name: 'title', description: 'Slot title', required: true },
          { name: 'body', description: 'Slot body', required: true },
        ],
      });

      const list = await ctx.app.request('/v1/templates?limit=10', { headers: ctx.authHeaders });
      expect(list.status).toBe(200);
      expect((await json(list)).items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ slug: 'promoted-weekly', built_in: false }),
        ])
      );

      const publish = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'uses-promoted-weekly',
          title: 'Uses promoted',
          template: 'promoted-weekly',
          slots: { title: 'Promoted title', body: 'Promoted body' },
        }),
      });
      expect(publish.status).toBe(201);
      expect(await json(publish)).toMatchObject({
        content: '# Promoted title\n\nIntro: Promoted body\n\nAgain: Promoted body',
      });
    } finally {
      await ctx.cleanup();
    }
  });

  it('rejects html artifact promotion as validation_failed', async () => {
    const ctx = await createApiTestContext();

    try {
      const source = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'html-promotion-source',
          type: 'html',
          title: 'HTML Promotion Source',
          content: '<h1>{{title}}</h1>',
        }),
      });
      expect(source.status).toBe(201);
      const sourceBody = await json(source);

      const promoted = await ctx.app.request('/v1/templates', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          artifact_id: sourceBody.id,
          slug: 'html-template',
          name: 'HTML Template',
        }),
      });
      expect(promoted.status).toBe(400);
      expect(await json(promoted)).toMatchObject({
        error: {
          code: 'validation_failed',
          details: { field: 'type', reason: 'html_not_supported' },
        },
      });
    } finally {
      await ctx.cleanup();
    }
  });
});
