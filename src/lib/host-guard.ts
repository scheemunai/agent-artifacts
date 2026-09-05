import type { MiddlewareHandler } from 'hono';
import type { AppConfig } from '../config.js';
import { OWNER_PREVIEW_TOKEN_PATTERN } from './preview-token.js';
import { TEMPLATE_FRAME_PATH } from './template-frame.js';

const SHARE_FRAME_PATH = /^\/a\/[A-Za-z0-9_-]{22}\/frame$/;
/**
 * The owner preview frame. Second entry on this list, and the shape of the token is spelled out
 * rather than accepting any segment: the guard's job is to keep the sandbox host down to the
 * handful of URLs that are *meant* to answer there, and `/preview/anything/frame` would be a hole
 * the route behind it then has to close on its own.
 *
 * The token pattern is imported, not retyped. Two regexes for one format is how a guard and the
 * route it guards start disagreeing.
 */
const OWNER_PREVIEW_FRAME_PATH = new RegExp(
  `^/preview/${OWNER_PREVIEW_TOKEN_PATTERN.source.replace(/^\^|\$$/g, '')}/frame$`
);

export function sandboxHostGuard(config: AppConfig): MiddlewareHandler {
  return async (context, next) => {
    if (!isSandboxHostRequest(config, context.req.url, context.req.header('host'))) {
      await next();
      return;
    }

    const path = new URL(context.req.url).pathname;
    if (isSandboxAllowedPath(path)) {
      await next();
      return;
    }

    return context.text('Not found', 404);
  };
}

export function isSandboxHostRequest(
  config: Pick<AppConfig, 'sandboxOrigin'>,
  requestUrl: string,
  hostHeader?: string
): boolean {
  if (!config.sandboxOrigin) {
    return false;
  }

  const sandboxHost = normalizedHost(config.sandboxOrigin);
  const requestHost = normalizedRequestHost(requestUrl, hostHeader);
  return Boolean(sandboxHost && requestHost && sandboxHost === requestHost);
}

/**
 * Third entry, and the one with no token in it: the public template gallery's preview.
 *
 * It needs none. Every other frame here carries somebody's content and is reached by a URL that
 * proves the reader may see it; a starter template is ours, is already served in full to any
 * authenticated agent through `GET /v1/templates/:slug`, and is linked from a page with no account
 * behind it. The pattern is imported from where the URL is built, so the host that must answer and
 * the page that embeds cannot end up describing different paths.
 */
export function isSandboxAllowedPath(path: string): boolean {
  return (
    path === '/robots.txt' ||
    SHARE_FRAME_PATH.test(path) ||
    OWNER_PREVIEW_FRAME_PATH.test(path) ||
    TEMPLATE_FRAME_PATH.test(path)
  );
}

/**
 * Where a frame request that landed on the app host should be sent instead, or `null` when it is
 * already in the right place (or when there is no second host at all).
 *
 * Both frame routes need this and both used to be the only caller of their own copy. Sharing it
 * means the public artifact frame and the owner preview frame cannot end up with different ideas
 * about what "wrong host" means — which matters more than the eight lines, because the answer is a
 * 301 that a browser will remember.
 */
export function sandboxRedirectUrl(
  config: Pick<AppConfig, 'sandboxOrigin'>,
  requestUrl: string,
  hostHeader?: string
): string | null {
  if (!config.sandboxOrigin) {
    return null;
  }

  if (isSandboxHostRequest(config, requestUrl, hostHeader)) {
    return null;
  }

  const url = new URL(requestUrl);
  const target = new URL(config.sandboxOrigin);
  target.pathname = url.pathname;
  target.search = url.search;
  return target.toString();
}

function normalizedHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

function normalizedRequestHost(requestUrl: string, hostHeader?: string): string | null {
  if (hostHeader?.trim()) {
    return hostHeader.trim().toLowerCase();
  }

  try {
    return new URL(requestUrl).host.toLowerCase();
  } catch {
    return null;
  }
}
