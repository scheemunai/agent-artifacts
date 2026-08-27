import type { Env, Hono } from 'hono';
import type { AppConfig } from '../config.js';
import { isSandboxHostRequest, sandboxHostGuard } from '../lib/host-guard.js';

export function registerRobotsAndSandboxGuard<E extends Env>(
  app: Hono<E>,
  config: AppConfig
): void {
  app.use('*', sandboxHostGuard(config));
  registerRobotsRoute(app, config);
}

function registerRobotsRoute<E extends Env>(app: Hono<E>, config: AppConfig): void {
  app.get('/robots.txt', (context) => {
    context.header('Content-Type', 'text/plain; charset=utf-8');
    context.header('Cache-Control', 'public, max-age=3600');

    const body = isSandboxHostRequest(config, context.req.url, context.req.header('host'))
      ? sandboxRobotsTxt()
      : appRobotsTxt();

    return context.text(body);
  });
}

export function appRobotsTxt(): string {
  return [
    'User-agent: *',
    '# Public artifact share pages under /a/ are unlisted-but-public and may be crawled when linked.',
    'Allow: /a/',
    'Allow: /assets/',
    'Disallow: /dashboard',
    'Disallow: /login',
    'Disallow: /setup',
    'Disallow: /auth',
    'Disallow: /v1',
    '',
  ].join('\n');
}

export function sandboxRobotsTxt(): string {
  return ['User-agent: *', 'Disallow: /', ''].join('\n');
}
