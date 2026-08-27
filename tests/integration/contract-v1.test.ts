import { describe, expect, it } from 'vitest';
import { promoteTemplateSchema, publishArtifactSchema } from '../../src/lib/schemas/index.js';
import { createApiTestContext, json } from './api-test-utils.js';

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

const documentedPromoteTemplateFields = ['artifact_id', 'name', 'slug', 'description'];

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

const CONTRACT_OMITTED: Record<string, string> = {
  'GET /v1/openapi.json':
    'Machine-readable spec endpoint linked by path, not duplicated as an operation.',
};

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
      expect(text).toContain('the public URL is exactly at response.share.url');

      const llms = await ctx.app.request('/llms.txt');
      expect(llms.status).toBe(200);
      expect(await llms.text()).toBe(text);
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps documented publish examples aligned with the real Zod schema and template API', async () => {
    const schemaKeys = Object.keys(publishArtifactSchema.shape).sort();
    expect(schemaKeys).toEqual([...documentedPublishFields].sort());

    const promoteSchemaKeys = Object.keys(promoteTemplateSchema.shape).sort();
    expect(promoteSchemaKeys).toEqual([...documentedPromoteTemplateFields].sort());

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
    const promoteTemplateExample = {
      artifact_id: 'art_abcdefghijklmnopqrstu',
      name: 'Ops Brief',
      slug: 'ops-brief',
      description: 'Optional short description',
    };

    expect(publishArtifactSchema.safeParse(directPublishExample).success).toBe(true);
    expect(publishArtifactSchema.safeParse(templatePublishExample).success).toBe(true);
    expect(promoteTemplateSchema.safeParse(promoteTemplateExample).success).toBe(true);

    const ctx = await createApiTestContext();
    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(templatePublishExample),
      });
      expect(response.status).toBe(201);
      const body = await json(response);
      expect(body).toMatchObject({
        slug: 'weekly-report',
        type: 'markdown',
        share: { url: expect.stringMatching(new RegExp(`^${ctx.config.baseUrl}/a/`)) },
      });
      expect(body.content).toContain('## Highlights');
      expect(body.content).toContain('Ship v2.2');
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps every OpenAPI path and method documented or explicitly omitted from the contract', async () => {
    const ctx = await createApiTestContext();

    try {
      const [contractResponseValue, openApiResponse] = await Promise.all([
        ctx.app.request('/v1/contract'),
        ctx.app.request('/v1/openapi.json'),
      ]);
      expect(contractResponseValue.status).toBe(200);
      expect(openApiResponse.status).toBe(200);

      const contract = await contractResponseValue.text();
      const spec = (await openApiResponse.json()) as {
        paths: Record<string, unknown>;
      };
      const endpoints = openApiEndpoints(spec.paths);

      for (const [endpoint, reason] of Object.entries(CONTRACT_OMITTED)) {
        expect(endpoints).toContain(endpoint);
        expect(reason.trim()).not.toBe('');
        expect(reason.length).toBeLessThanOrEqual(120);
      }

      const undocumented = endpoints.filter(
        (endpoint) => !contract.includes(endpoint) && !(endpoint in CONTRACT_OMITTED)
      );
      expect(undocumented).toEqual([]);
      expect(contract).toContain('POST /v1/templates');
      expect(contract).toContain('details.reason="html_not_supported"');
      expect(contract).toContain('details.reason="no_slots"');
    } finally {
      await ctx.cleanup();
    }
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

function openApiEndpoints(paths: Record<string, unknown>): string[] {
  const endpoints: string[] = [];
  for (const [path, operations] of Object.entries(paths)) {
    if (!isRecord(operations)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      if (method in operations) {
        endpoints.push(`${method.toUpperCase()} ${normalizeOpenApiPath(path)}`);
      }
    }
  }
  return endpoints.sort();
}

function normalizeOpenApiPath(path: string): string {
  return `/v1${path.replace(/\{([^}]+)\}/g, ':$1')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
