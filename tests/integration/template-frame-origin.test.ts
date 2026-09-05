import { describe, expect, it } from 'vitest';
import { isSandboxAllowedPath } from '../../src/lib/host-guard.js';
import { loadStarterTemplates } from '../../src/services/templates.js';
import { createViewerTestContext } from './viewer/viewer-test-utils.js';

/**
 * The gallery's preview frame, asserted under BOTH deployment shapes.
 *
 * This file exists because the whole suite ran under one of them. Self-hosted has a single host, so
 * `frame-src` falls back to `'self'` and a relative `src="/templates/:slug/frame"` loads — every
 * existing assertion about that frame was written against the only configuration where a
 * same-origin frame can work. Cloud sets `SANDBOX_ORIGIN`, the dashboard's `frame-src` narrows to
 * that one host, and the same relative URL is refused by the browser before the request is made:
 *
 *   Framing 'https://agentartifact.ai/templates/project-plan/frame' violates the following
 *   Content Security Policy directive: "frame-src https://usercontent.agentartifact.ai".
 *
 * A green suite and a blank frame in production, because the frame endpoint was healthy the whole
 * time — 200, valid HTML, and never fetched. So these run the real app with `SANDBOX_ORIGIN` set
 * and read the page the way a browser does: take the `src` the page actually shipped, resolve it,
 * and hold it against the CSP that arrived in the same response.
 */
const SANDBOX_ORIGIN = 'https://usercontent.example.test';
const APP_ORIGIN = 'https://agentartifact.example.test';

const htmlTemplates = loadStarterTemplates().filter((template) => template.type === 'html');

function frameSrc(html: string): string {
  const match = html.match(/<iframe\b[^>]*\bsrc="([^"]+)"/);
  expect(match?.[1], 'the detail page rendered no iframe at all').toBeTruthy();
  return String(match?.[1]);
}

/**
 * What the browser does with `frame-src`, reduced to the two values this app ever emits: `'self'`
 * (self-hosted, one host) or an explicit origin (cloud). Resolving the `src` first is the point —
 * a relative URL is same-origin no matter how it is spelled, which is exactly what made the bug
 * invisible to a string comparison against the path.
 */
function cspAdmitsFrame(csp: string | null, resolvedSrc: string, pageOrigin: string): boolean {
  const directive = (csp ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('frame-src '));
  expect(directive, 'the page carried no frame-src at all').toBeTruthy();

  const sources = String(directive).slice('frame-src '.length).split(/\s+/);
  const origin = new URL(resolvedSrc).origin;
  return sources.some((source) =>
    source === "'self'" ? origin === pageOrigin : source === origin
  );
}

describe('the template gallery frames a URL its own CSP allows', () => {
  it('points the frame at the sandbox host when the deployment has one', async () => {
    const ctx = await createViewerTestContext({ sandboxOrigin: SANDBOX_ORIGIN });
    try {
      const response = await ctx.app.request(`${APP_ORIGIN}/templates/project-plan`);
      const src = frameSrc(await response.text());
      const resolved = new URL(src, `${APP_ORIGIN}/templates/project-plan`);

      // The assertion the shipped bug fails: a relative src resolves to the app origin, and the
      // app origin is not in `frame-src` on a deployment that has a sandbox host.
      expect(resolved.origin).toBe(SANDBOX_ORIGIN);
      expect(resolved.pathname).toBe('/templates/project-plan/frame');
    } finally {
      await ctx.cleanup();
    }
  });

  it('keeps the frame same-origin when the deployment has no sandbox host', async () => {
    // The self-hosted half, which must keep working unchanged: one host, `frame-src 'self'`, and
    // an app-origin frame is the only frame there is. The fix is one origin choice, not a rewrite.
    const ctx = await createViewerTestContext();
    try {
      const response = await ctx.app.request(`${APP_ORIGIN}/templates/project-plan`);
      const src = frameSrc(await response.text());
      const resolved = new URL(src, `${APP_ORIGIN}/templates/project-plan`);

      expect(resolved.origin).toBe(APP_ORIGIN);
      expect(resolved.pathname).toBe('/templates/project-plan/frame');
    } finally {
      await ctx.cleanup();
    }
  });

  it('ships no HTML template whose frame its own response would refuse to load', async () => {
    // The class, not the instance. Whatever a page embeds is held against the policy that arrived
    // with it, for every HTML template and both deployment shapes — so the next frame added to
    // this page cannot be same-origin-only either.
    expect(htmlTemplates.length).toBeGreaterThan(1);

    for (const sandboxOrigin of [SANDBOX_ORIGIN, undefined]) {
      const ctx = await createViewerTestContext(sandboxOrigin ? { sandboxOrigin } : {});
      try {
        for (const template of htmlTemplates) {
          const pageUrl = `${APP_ORIGIN}/templates/${template.slug}`;
          const response = await ctx.app.request(pageUrl);
          expect(response.status, template.slug).toBe(200);

          const resolved = new URL(frameSrc(await response.text()), pageUrl).toString();
          expect(
            cspAdmitsFrame(response.headers.get('content-security-policy'), resolved, APP_ORIGIN),
            `${template.slug} embeds ${resolved}, which its own frame-src blocks (sandboxOrigin=${String(sandboxOrigin)})`
          ).toBe(true);
        }
      } finally {
        await ctx.cleanup();
      }
    }
  });
});

describe('the URL the gallery embeds is a URL the sandbox host answers', () => {
  it('is allowed by the sandbox host guard, not just by the CSP', () => {
    // Two gates, and passing one is not passing the other. The guard trims the sandbox host to the
    // handful of paths meant to answer there; a frame URL the CSP permits and the guard 404s is
    // the same blank frame with a different cause.
    expect(isSandboxAllowedPath('/templates/project-plan/frame')).toBe(true);
    expect(isSandboxAllowedPath('/templates/project-plan')).toBe(false);
    expect(isSandboxAllowedPath('/templates')).toBe(false);
    expect(isSandboxAllowedPath('/templates/project-plan/frame/../../dashboard')).toBe(false);
    expect(isSandboxAllowedPath('/templates/Not-A-Slug/frame')).toBe(false);
  });

  it('serves the frame on the sandbox host, with the document the page came for', async () => {
    const ctx = await createViewerTestContext({ sandboxOrigin: SANDBOX_ORIGIN });
    try {
      const page = await ctx.app.request(`${APP_ORIGIN}/templates/project-plan`);
      const embedded = new URL(
        frameSrc(await page.text()),
        `${APP_ORIGIN}/templates/project-plan`
      ).toString();

      // The exact URL the page shipped, fetched from the host it names. Nothing is reconstructed
      // here — a test that rebuilds the URL cannot catch the page building a different one.
      const frame = await ctx.app.request(embedded);

      expect(frame.status).toBe(200);
      expect(frame.headers.get('content-type')).toContain('text/html');
      await expect(frame.text()).resolves.toContain('<!doctype html>');
      // The other half of the handshake. Framing needs both sides to agree, and each is a separate
      // policy on a separate response: the page's `frame-src` has to name the sandbox host, and the
      // frame's `frame-ancestors` has to name the app host back. Asserting only one leaves the
      // symptom — a blank frame — reachable from the side that was not checked.
      expect(frame.headers.get('content-security-policy')).toContain(
        `frame-ancestors ${APP_ORIGIN}`
      );
    } finally {
      await ctx.cleanup();
    }
  });
});
