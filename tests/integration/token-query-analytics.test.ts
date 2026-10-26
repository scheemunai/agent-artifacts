import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { TOKEN_QUERY_ROUTE_PATHS } from '../../src/routes/auth.js';
import type { AuthTestContext } from './auth-test-utils.js';
import { createAuthTestContext } from './auth-test-utils.js';

const SITE_ID = 'dc_TESTonlyIdNotReal000';
const DATABULL_ORIGIN = 'databull.subscriptions-972.workers.dev';
let contexts: AuthTestContext[] = [];

afterEach(async () => {
  await Promise.all(contexts.map((context) => context.cleanup()));
  contexts = [];
});

describe('analytics on query-token pages', () => {
  it('renders no tracker or site id on every registered secret-bearing route', async () => {
    const context = await createAuthTestContext({ AA_DATABULL_SITE_ID: SITE_ID });
    contexts.push(context);

    expect(TOKEN_QUERY_ROUTE_PATHS).toHaveLength(2);
    for (const path of TOKEN_QUERY_ROUTE_PATHS) {
      const response = await context.app.request(`${path}?token=not-a-real-token`);
      const html = await response.text();

      expect(response.status, path).toBe(200);
      expect(html, path).not.toContain(DATABULL_ORIGIN);
      expect(html, path).not.toContain(SITE_ID);
    }
  });

  it('requires every token query read to pass through the tested route registry', () => {
    const source = readFileSync(new URL('../../src/routes/auth.ts', import.meta.url), 'utf8');
    const directReads = source.match(/req\.query\(\s*['"]token['"]\s*\)/g) ?? [];

    // There is one read because the registry owns one registration loop. A new route that reads a
    // token directly makes this fail; adding it to the registry makes the route test above exercise
    // its rendered document and prove the analytics veto instead.
    expect(directReads).toHaveLength(1);
  });
});
