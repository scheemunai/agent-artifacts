import type { MiddlewareHandler } from 'hono';
import type { AppConfig } from '../config.js';

const SHARE_FRAME_PATH = /^\/a\/[A-Za-z0-9_-]{22}\/frame$/;
const SANDBOX_ASSET_PATH = /^\/assets\//;

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

export function isSandboxAllowedPath(path: string): boolean {
  return path === '/robots.txt' || SHARE_FRAME_PATH.test(path) || SANDBOX_ASSET_PATH.test(path);
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
