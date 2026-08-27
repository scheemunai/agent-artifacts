import { describe, expect, it } from 'vitest';
import { createViewerTestContext, publishSharedArtifact } from './viewer/viewer-test-utils.js';

describe('sandbox host guard', () => {
  it('returns 404 for non-frame app and API paths on SANDBOX_ORIGIN while leaving the app host unchanged', async () => {
    const sandboxOrigin = 'https://usercontent.example.test';
    const ctx = await createViewerTestContext({ sandboxOrigin });
    try {
      const appContract = await ctx.app.request('https://agentartifact.example.test/v1/contract');
      expect(appContract.status).toBe(200);
      await expect(appContract.text()).resolves.toContain('Agent Artifacts — API Contract');

      for (const path of [
        '/healthz',
        '/v1/contract',
        '/v1/openapi.json',
        '/v1/artifacts',
        '/login',
      ]) {
        const response = await ctx.app.request(`${sandboxOrigin}${path}`);
        expect(response.status, path).toBe(404);
        await expect(response.text(), path).resolves.toBe('Not found');
        expect(response.headers.get('set-cookie'), path).toBeNull();
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('continues to serve artifact frames on SANDBOX_ORIGIN', async () => {
    const sandboxOrigin = 'https://usercontent.example.test';
    const ctx = await createViewerTestContext({ sandboxOrigin });
    try {
      const artifact = await publishSharedArtifact(ctx, {
        type: 'html',
        content: '<!doctype html><title>Sandbox frame</title><h1>Frame only</h1>',
      });
      const shareId = artifact.share?.shareId;
      expect(shareId).toBeTruthy();

      const response = await ctx.app.request(`${sandboxOrigin}/a/${shareId}/frame`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(html).toContain('<h1>Frame only</h1>');
      expect(response.headers.get('content-security-policy')).toContain(
        'frame-ancestors https://agentartifact.example.test'
      );
      expect(response.headers.get('set-cookie')).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
