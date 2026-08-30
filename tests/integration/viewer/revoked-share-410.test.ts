import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ageArtifact,
  createTestCloudModule,
  createViewerTestContext,
  publishSharedArtifact,
  revokeShare,
  suspendAccount,
  testPlan,
} from './viewer-test-utils.js';

const UNKNOWN_SHARE_ID = 'AbCdEfGhIjKlMnOpQrStUv';

describe('viewer share lifecycle responses', () => {
  it('returns 410 for revoked shares and 404 for never-created share ids on every public surface', async () => {
    const ctx = await createViewerTestContext();

    try {
      const created = await publishSharedArtifact(ctx, {
        type: 'html',
        slug: 'revoked-html',
        title: 'Revoked HTML',
        content: '<!doctype html><h1>Revoked</h1>',
      });
      const shareId = created.share?.shareId as string;
      revokeShare(ctx, shareId);

      for (const path of [
        `/a/${shareId}`,
        `/a/${shareId}/content`,
        `/a/${shareId}/frame`,
        `/a/${shareId}/download`,
      ]) {
        const response = await ctx.app.request(path);
        expect(response.status, path).toBe(410);
      }

      for (const path of [
        `/a/${UNKNOWN_SHARE_ID}`,
        `/a/${UNKNOWN_SHARE_ID}/content`,
        `/a/${UNKNOWN_SHARE_ID}/frame`,
        `/a/${UNKNOWN_SHARE_ID}/download`,
      ]) {
        const response = await ctx.app.request(path);
        expect(response.status, path).toBe(404);
      }
    } finally {
      await ctx.cleanup();
    }
  });

  it('returns clean 410 pages for suspended accounts and retention-expired artifacts', async () => {
    const suspendedCtx = await createViewerTestContext();
    try {
      const created = await publishSharedArtifact(suspendedCtx, { slug: 'suspended-report' });
      const shareId = created.share?.shareId as string;
      suspendAccount(suspendedCtx);

      const response = await suspendedCtx.app.request(`/a/${shareId}`);
      const html = await response.text();
      expect(response.status).toBe(410);
      // The owner did not revoke this link, so the page must not say they did. It also must not
      // disclose *why* — the recipient is not entitled to the account's moderation state.
      expect(html).not.toContain('The owner turned off sharing for this artifact.');
      expect(html).toContain('This link is no longer available.');
      expect(html).toContain('aa-viewer-footer__brand');
    } finally {
      await suspendedCtx.cleanup();
    }

    const expiredCtx = await createViewerTestContext({
      cloudModule: createTestCloudModule(testPlan({ artifact_retention_days: 1 })),
    });
    try {
      const created = await publishSharedArtifact(expiredCtx, { slug: 'expired-report' });
      const shareId = created.share?.shareId as string;
      ageArtifact(expiredCtx, created.artifact.id, Date.now() - 2 * 86_400_000);

      const response = await expiredCtx.app.request(`/a/${shareId}`);
      const html = await response.text();
      expect(response.status).toBe(410);
      expect(html).toContain('This artifact has expired.');
      expect(html).toContain('aa-viewer-footer__brand');

      // Retention expiry is its own cause and carries its own code. It used to be thrown as
      // `share_revoked` — the code meaning "the owner turned this off" — which was untrue, and
      // forced the page to recover the real cause by string-matching the error message.
      const api = await expiredCtx.app.request(`/a/${shareId}/content`);
      expect(api.status).toBe(410);
      expect(await api.json()).toMatchObject({ error: { code: 'artifact_expired' } });
    } finally {
      await expiredCtx.cleanup();
    }
  });

  it('selects every terminal copy by error code, never by sniffing the message', () => {
    // The class, not the instance. One branch recovering a cause from `error.message` is a
    // stringly-typed fallback that works until someone rewords a message in an unrelated commit —
    // and it survives precisely because the copy assertions above still pass when it breaks.
    const source = readFileSync(new URL('../../../src/routes/public.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function terminalCopy(');
    expect(start, 'terminalCopy not found in public.ts').toBeGreaterThan(-1);
    // To the next top-level declaration, not to the next `\n}`: the function's return type is an
    // object literal that closes at column 0, so a lazy brace match ends inside the signature and
    // every assertion below it passes on an empty body. The positive assertion is what caught that.
    const end = source.indexOf('\nfunction ', start + 1);
    const terminalCopy = source.slice(start, end === -1 ? undefined : end);

    expect(terminalCopy, 'extracted no function body').toMatch(/return\s*\{/);
    expect(terminalCopy, 'terminal copy is selected by message text').not.toMatch(/error\.message/);
    expect(terminalCopy).toMatch(/error\.code/);
  });
});
