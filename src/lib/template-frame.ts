import type { AppConfig } from '../config.js';
import { SLUG_PATTERN } from './schemas/artifacts.js';

/**
 * Where the public template gallery's live preview is framed from.
 *
 * ── WHY THIS IS NOT A RELATIVE URL ─────────────────────────────────────────────────────────────
 *
 * The detail page used to embed `src="/templates/:slug/frame"` — same-origin, and therefore
 * loadable only on a deployment whose `frame-src` is `'self'`. Self-hosted has one host and that
 * is exactly what it gets, so the frame worked and every test agreed. Cloud sets `SANDBOX_ORIGIN`,
 * which narrows the app origin's `frame-src` to the sandbox host alone, and the browser refused
 * the relative URL before it ever issued a request:
 *
 *   Framing 'https://agentartifact.ai/templates/project-plan/frame' violates the following
 *   Content Security Policy directive: "frame-src https://usercontent.agentartifact.ai".
 *
 * The endpoint was healthy the whole time. Only the framing was blocked, which is why it read as a
 * content bug and was not one.
 *
 * Re-admitting `'self'` to the app origin's `frame-src` would fix the symptom and undo the reason
 * the second host exists — see the comment atop `preview-token.ts`: it would let framed HTML run
 * scripts on the origin holding the owner's session cookie. So this makes the same single choice
 * `ViewerService.frameUrl()` and `ownerPreviewFrameUrl()` already make, and for the same reason.
 * One code path serves both deployments; nothing is conditional except the origin.
 */
export function templateFramePath(slug: string): string {
  return `/templates/${slug}/frame`;
}

/**
 * The same path as a pattern, for the sandbox host guard.
 *
 * The slug shape is imported rather than retyped: `SLUG_PATTERN` is what validates a slug
 * everywhere else, and two regexes for one format is how a guard and the route behind it start
 * disagreeing. The guard trims the sandbox host to the paths meant to answer there; which of those
 * slugs is a shipped HTML template stays the route's question, and it still 404s the rest.
 */
export const TEMPLATE_FRAME_PATH = new RegExp(
  `^${templateFramePath(`(?:${SLUG_PATTERN.source.replace(/^\^|\$$/g, '')})`)}$`
);

/**
 * The absolute URL the gallery embeds: the sandbox host where there is one, the app's own host
 * where there is not.
 */
export function templateFrameUrl(
  config: Pick<AppConfig, 'sandboxOrigin' | 'baseUrl'>,
  slug: string
): string {
  return new URL(templateFramePath(slug), config.sandboxOrigin ?? config.baseUrl).toString();
}
