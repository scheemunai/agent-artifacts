import { describe, expect, it } from 'vitest';
import { publishArtifactSchema } from '../../src/lib/schemas/index.js';
import { createApiTestContext } from './api-test-utils.js';

const documentedPublishFields = [
  'slug',
  'type',
  'title',
  'content',
  'template',
  'slots',
  'metadata',
  'change_summary',
  'share',
  'password',
];

describe('V1 contract endpoint', () => {
  it('serves the agent contract as text/markdown without authentication', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/contract');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
      const text = await response.text();
      expect(text).toContain(`# Agent Artifacts — API Contract (v1)`);
      expect(text).toContain(`Base URL: ${ctx.config.baseUrl}/v1`);
      expect(text).toContain('POST the same slug again = UPDATE');

      const llms = await ctx.app.request('/llms.txt');
      expect(llms.status).toBe(200);
      expect(await llms.text()).toBe(text);
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps documented publish examples aligned with the real Zod schema', async () => {
    const schemaKeys = Object.keys(publishArtifactSchema.shape).sort();
    expect(schemaKeys).toEqual([...documentedPublishFields].sort());

    const directPublishExample = {
      slug: 'weekly-report',
      type: 'markdown',
      title: 'Weekly Report — W34',
      content: '# Weekly Report\n...',
      change_summary: 'Added incident retro',
      share: true,
    };
    const templatePublishExample = {
      slug: 'weekly-report',
      title: 'Week 34',
      template: 'report',
      slots: {
        title: 'Week 34',
        date: '2026-08-25',
        summary: 'Shipped v2.1 ...',
        body: '## Highlights\n...',
        next_steps: '- Ship v2.2',
      },
      share: true,
    };

    expect(publishArtifactSchema.safeParse(directPublishExample).success).toBe(true);
    expect(publishArtifactSchema.safeParse(templatePublishExample).success).toBe(true);
  });

  it('serves an OpenAPI document with every v1 path', async () => {
    const ctx = await createApiTestContext();

    try {
      const response = await ctx.app.request('/v1/openapi.json');
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
      const spec = (await response.json()) as {
        openapi: string;
        servers: Array<{ url: string }>;
        paths: Record<string, unknown>;
      };
      expect(spec.openapi).toBe('3.1.0');
      expect(spec.servers).toEqual([{ url: `${ctx.config.baseUrl}/v1` }]);
      expect(Object.keys(spec.paths).sort()).toEqual(
        [
          '/artifacts',
          '/artifacts/{id_or_slug}',
          '/artifacts/{id_or_slug}/download',
          '/artifacts/{id_or_slug}/share',
          '/artifacts/{id_or_slug}/versions',
          '/artifacts/{id_or_slug}/versions/{n}',
          '/artifacts/{id_or_slug}/versions/{n}/restore',
          '/contract',
          '/openapi.json',
          '/templates',
          '/templates/{slug}',
        ].sort()
      );
    } finally {
      await ctx.cleanup();
    }
  });
});
