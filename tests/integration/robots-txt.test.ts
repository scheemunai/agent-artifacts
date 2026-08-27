import { describe, expect, it } from 'vitest';
import { createViewerTestContext } from './viewer/viewer-test-utils.js';

describe('robots.txt', () => {
  it('serves app-host crawler policy without noindexing public share pages', async () => {
    const ctx = await createViewerTestContext({
      sandboxOrigin: 'https://usercontent.example.test',
    });
    try {
      const response = await ctx.app.request('https://agentartifact.example.test/robots.txt');
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^text\/plain/i);
      expect(body).toContain('User-agent: *');
      expect(body).toContain('Allow: /a/');
      expect(body).toContain('Allow: /assets/');
      expect(body).toContain('Disallow: /dashboard');
      expect(body).toContain('Disallow: /login');
      expect(body).toContain('Disallow: /setup');
      expect(body).toContain('Disallow: /auth');
      expect(body).toContain('Disallow: /v1');
      expect(body).not.toMatch(/^Disallow: \/a\/?$/m);
      expect(body).not.toBe('User-agent: *\nDisallow: /\n');
    } finally {
      await ctx.cleanup();
    }
  });

  it('serves a deny-all crawler policy on SANDBOX_ORIGIN', async () => {
    const sandboxOrigin = 'https://usercontent.example.test';
    const ctx = await createViewerTestContext({ sandboxOrigin });
    try {
      const response = await ctx.app.request(`${sandboxOrigin}/robots.txt`);
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/^text\/plain/i);
      expect(body).toBe('User-agent: *\nDisallow: /\n');
      expect(response.headers.get('set-cookie')).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
