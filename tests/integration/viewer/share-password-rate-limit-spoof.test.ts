import { describe, expect, it } from 'vitest';
import { createViewerTestContext, publishSharedArtifact } from './viewer-test-utils.js';

describe('share password rate-limit client IP resolution', () => {
  it('ignores spoofed forwarding headers at default AA_TRUST_PROXY=0', async () => {
    const ctx = await createViewerTestContext({ rateLimitsDisabled: false });

    try {
      const created = await publishSharedArtifact(ctx, {
        slug: 'protected-spoof-test',
        title: 'Protected Spoof Test',
        content: '# Secret',
        password: 'correct horse',
      });
      const shareId = created.share?.shareId ?? '';

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await verifyWithSpoofedHeaders(ctx.app, shareId, attempt);
        expect(response.status).toBe(401);
      }

      const blocked = await verifyWithSpoofedHeaders(ctx.app, shareId, 10);
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBeTruthy();
      await expect(blocked.json()).resolves.toMatchObject({
        error: { code: 'rate_limited' },
      });
    } finally {
      await ctx.cleanup();
    }
  });
});

async function verifyWithSpoofedHeaders(
  app: Awaited<ReturnType<typeof createViewerTestContext>>['app'],
  shareId: string,
  attempt: number
): Promise<Response> {
  return await app.request(`/a/${shareId}/verify-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `203.0.113.${attempt + 1}`,
      'X-Real-IP': `198.51.100.${attempt + 1}`,
      'CF-Connecting-IP': `192.0.2.${attempt + 1}`,
    },
    body: JSON.stringify({ password: `wrong-${attempt}` }),
  });
}
