import type { AppConfig } from '../config.js';

export const FRAME_CONTENT_TYPE = 'text/html; charset=utf-8';
export const APP_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=()';

const DASHBOARD_PREVIEW_CONTENT_TYPE = 'text/html; charset=utf-8';

/**
 * Every frame variant, as data. The type is derived from this array rather than declared beside it,
 * so there is one place to add a variant and no way to add one that a test walking this list would
 * miss. A hand-written union plus a hand-written test array is two lists that agree until they
 * don't — which is what "a third variant cannot forget" claimed while iterating a literal.
 */
export const FRAME_POLICY_VARIANTS = ['public-artifact', 'dashboard-preview'] as const;

export type FramePolicyVariant = (typeof FRAME_POLICY_VARIANTS)[number];

export interface FrameHeadersInput {
  config: AppConfig;
  variant: FramePolicyVariant;
  passwordProtected?: boolean;
}

/**
 * Exhaustive by construction. These were a ternary and an `if` with a fallthrough — and they fell
 * through *opposite ways*: an unrecognised variant took the dashboard CSP here and the public
 * artifact headers below, so a third variant would have been served a mismatched pair rather than
 * failing. Now adding a member to `FRAME_POLICY_VARIANTS` breaks the build until both are handled,
 * which is a stronger guarantee than any test: it cannot be merged red.
 */
export function frameCsp(config: AppConfig, variant: FramePolicyVariant): string {
  switch (variant) {
    case 'public-artifact':
      return publicArtifactFrameCsp(config);
    case 'dashboard-preview':
      return dashboardPreviewFrameCsp();
    default:
      return assertNeverVariant(variant);
  }
}

export function frameHeaders(input: FrameHeadersInput): Record<string, string> {
  switch (input.variant) {
    case 'public-artifact':
      return publicArtifactFrameHeaders(input);
    case 'dashboard-preview':
      return dashboardPreviewFrameHeaders(input.config);
    default:
      return assertNeverVariant(input.variant);
  }
}

function assertNeverVariant(variant: never): never {
  // Unreachable while the switches above are exhaustive; kept as a runtime backstop because the
  // variant can arrive from a caller that was not type-checked against this module.
  throw new Error(`unhandled frame policy variant: ${String(variant)}`);
}

export function publicArtifactFrameHeaders(
  input: Pick<FrameHeadersInput, 'config' | 'passwordProtected'>
): Record<string, string> {
  return {
    'Content-Type': FRAME_CONTENT_TYPE,
    'Content-Security-Policy': frameCsp(input.config, 'public-artifact'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Permissions-Policy': APP_PERMISSIONS_POLICY,
    'Cache-Control': input.passwordProtected ? 'no-store' : 'public, max-age=3600',
  };
}

export function dashboardPreviewFrameHeaders(config: AppConfig): Record<string, string> {
  void config;
  return {
    'Content-Type': DASHBOARD_PREVIEW_CONTENT_TYPE,
    'Content-Security-Policy': frameCsp(config, 'dashboard-preview'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': APP_PERMISSIONS_POLICY,
  };
}

function publicArtifactFrameCsp(config: AppConfig): string {
  const appOrigin = new URL(config.baseUrl).origin;
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    "script-src https: 'unsafe-inline' 'unsafe-eval'",
    "style-src https: 'unsafe-inline'",
    'img-src https: data: blob:',
    'font-src https: data:',
    'connect-src https:',
    'media-src https: data:',
    "form-action 'none'",
    `frame-ancestors ${appOrigin}`,
  ].join('; ');
}

function dashboardPreviewFrameCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: https:',
    "font-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    // `'self'` rather than the configured base URL, and the difference matters: the dashboard
    // embeds this route with a *relative* `src`, so the framing parent is whatever origin served
    // the dashboard — which is not always `baseUrl` behind a proxy, on a custom domain, or in
    // development. `'self'` is that origin by definition and cannot drift from it. The public
    // variant has to name an origin for the opposite reason: it is served from the sandbox host
    // and framed by the app host, so the two genuinely differ.
    "frame-ancestors 'self'",
    'sandbox allow-scripts',
  ].join('; ');
}
