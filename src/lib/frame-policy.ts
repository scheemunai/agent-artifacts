import type { AppConfig } from '../config.js';

export const FRAME_CONTENT_TYPE = 'text/html; charset=utf-8';
export const APP_PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=()';

const OWNER_PREVIEW_CONTENT_TYPE = 'text/html; charset=utf-8';

/**
 * Every frame variant, as data. The type is derived from this array rather than declared beside it,
 * so there is one place to add a variant and no way to add one that a test walking this list would
 * miss. A hand-written union plus a hand-written test array is two lists that agree until they
 * don't — which is what "a third variant cannot forget" claimed while iterating a literal.
 */
export const FRAME_POLICY_VARIANTS = ['public-artifact', 'owner-preview'] as const;

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
    case 'owner-preview':
      return ownerPreviewFrameCsp(config);
    default:
      return assertNeverVariant(variant);
  }
}

export function frameHeaders(input: FrameHeadersInput): Record<string, string> {
  switch (input.variant) {
    case 'public-artifact':
      return publicArtifactFrameHeaders(input);
    case 'owner-preview':
      return ownerPreviewFrameHeaders(input.config);
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

export function ownerPreviewFrameHeaders(config: AppConfig): Record<string, string> {
  return {
    'Content-Type': OWNER_PREVIEW_CONTENT_TYPE,
    'Content-Security-Policy': frameCsp(config, 'owner-preview'),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // The response is one owner's unpublished content behind a five-minute token, and on cloud it
    // now travels through whatever sits in front of the sandbox host. `no-store` is the difference
    // between that and a shared cache holding a private document at a guessable-once URL. The
    // public artifact frame can be cached for an hour precisely because it is public; this cannot.
    'Cache-Control': 'no-store',
    // Matches the public artifact frame. Not load-bearing today — the dashboard sets no COEP, so
    // nothing enforces CORP on this navigation — but the two frame responses are served from the
    // same host to embedders on another origin, and having one of them silently break the day a
    // COEP header appears is not a distinction worth keeping.
    'Cross-Origin-Resource-Policy': 'cross-origin',
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

/**
 * The owner's own preview of their HTML — the artifact detail card and the template panel.
 *
 * Stricter than the public variant on every directive that grants a capability, and deliberately
 * so: a public artifact is a published page whose author expects it to behave like one, while this
 * is a thumbnail of your own draft. No external script, no `connect-src`, no font, no form.
 *
 * `frame-ancestors` is the one directive that has to know where it is running, because this
 * response is served from a different host in the two deployments:
 *
 *   · cloud — served by the sandbox host, framed by the app host. Two genuinely different origins,
 *     so the app origin must be named, exactly as the public variant names it.
 *   · self-hosted — one host serves both, so `'self'` *is* the dashboard origin by definition and
 *     cannot drift from it behind a proxy, on a custom domain, or in development. That was the
 *     original reasoning for `'self'` here and it still holds wherever it still applies.
 */
function ownerPreviewFrameCsp(config: AppConfig): string {
  const embedder = config.sandboxOrigin ? new URL(config.baseUrl).origin : "'self'";
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: https:',
    "font-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${embedder}`,
    'sandbox allow-scripts',
  ].join('; ');
}
