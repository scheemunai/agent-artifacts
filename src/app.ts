import { serveStatic } from '@hono/node-server/serve-static';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { nanoid } from 'nanoid';
import type { AppConfig } from './config.js';
import type { DatabaseHandle } from './db/client.js';
import type { CloudModule } from './extension/cloud-module.js';
import { AppError, errorEnvelope, internalErrorEnvelope } from './lib/errors.js';
import { appPath } from './lib/runtime-paths.js';
import type { Logger } from './logger.js';
import { registerHumanRoutes } from './routes/dashboard.js';
import { healthRoute } from './routes/health.js';
import { registerOwnerPreviewRoutes } from './routes/preview.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerRobotsAndSandboxGuard } from './routes/robots.js';
import { registerV1Routes } from './routes/v1/index.js';
import { createWebRoute } from './routes/web.js';
import { SESSION_COOKIE_NAME } from './services/sessions.js';
import { isHashedAssetPath } from './ui/assets.js';
import { ErrorPage } from './ui/pages/error-page.js';

interface AppVariables {
  requestId: string;
  logger: Logger;
  requestPrincipal?: RequestPrincipalLog;
  auth?: { account?: { id: string }; bot?: { id: string } };
}

export interface RequestPrincipalLog {
  kind: 'bot' | 'dashboard';
  account_id: string;
  bot_id?: string;
}

export interface CreateAppOptions {
  config: AppConfig;
  logger: Logger;
  db?: DatabaseHandle;
  cloudModule?: CloudModule;
}

export function createApp({
  config,
  logger,
  db,
  cloudModule,
}: CreateAppOptions): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('*', async (context, next) => {
    const requestId = `req_${nanoid(12)}`;
    const childLogger = logger.child({ request_id: requestId });
    const start = performance.now();

    context.set('requestId', requestId);
    context.set('logger', childLogger);
    context.header('x-request-id', requestId);

    await next();

    childLogger.info(
      {
        method: context.req.method,
        path: new URL(context.req.url).pathname,
        status: context.res.status,
        duration_ms: Math.round(performance.now() - start),
        principal: requestPrincipalFromContext(context),
      },
      'request.complete'
    );
  });

  app.use('*', async (context, next) => {
    await next();
    context.header('X-Content-Type-Options', 'nosniff');

    if (config.secureCookies) {
      context.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }

    const contentType = context.res.headers.get('content-type')?.toLowerCase();
    if (contentType?.includes('text/html')) {
      if (!context.res.headers.has('Content-Security-Policy')) {
        context.header('Content-Security-Policy', appOriginCsp(config.frameOrigin));
      }
      if (!context.res.headers.has('Referrer-Policy')) {
        context.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      }
      if (!context.res.headers.has('Permissions-Policy')) {
        context.header(
          'Permissions-Policy',
          'camera=(), microphone=(), geolocation=(), payment=()'
        );
      }
    }
  });

  // Route mounting order is deliberate: sandbox host guard before app/API routes.
  registerRobotsAndSandboxGuard(app, config);
  // A content-hashed filename is a promise that these bytes never change at this URL, so it can be
  // cached forever; the build re-mints the name whenever the source moves. Only files with that
  // shape qualify. `/assets/` also holds checked-in files that keep their names across edits —
  // `og-fallback.png` is regenerated with every OG repaint, `build-missing.css` is a diagnostic —
  // and a year of immutable caching on those would strand the old copy in every CDN and browser.
  app.use('/assets/*', async (context, next) => {
    await next();
    if (isHashedAssetPath(context.req.path) && [200, 304].includes(context.res.status)) {
      context.header('Cache-Control', 'public, max-age=31536000, immutable');
    }
  });

  // Absolute, resolved from the installation: a relative root made every /assets/* request answer
  // 404 whenever the process was started from anywhere but the app directory.
  app.get('/assets/*', serveStatic({ root: appPath('public') }));
  // Browsers and crawlers request `/favicon.ico` at the root regardless of the page's <link>. Point
  // it at the SVG mark rather than letting it fall through to the JSON 404 handler.
  app.get('/favicon.ico', (context) => context.redirect('/assets/favicon.svg', 301));
  app.route('/healthz', healthRoute);
  const routesContext = {
    config,
    logger,
    ...(db ? { db } : {}),
    ...(cloudModule ? { cloudModule } : {}),
  };
  registerV1Routes(app, routesContext);
  registerPublicRoutes(app, routesContext);
  // Mounted beside the public frame rather than inside the dashboard: it answers on the sandbox
  // host, where no `/dashboard` path is allowed to exist at all.
  registerOwnerPreviewRoutes(app, routesContext);
  registerHumanRoutes(app, routesContext);
  app.route('/', createWebRoute(config, logger));
  cloudModule?.registerRoutes?.(app as unknown as OpenAPIHono);

  app.notFound((context) => {
    if (prefersHtmlError(context)) {
      return context.html(
        ErrorPage({ status: 404, code: 'not_found', chrome: errorPageChrome(context) }),
        404
      );
    }

    return context.json(
      {
        error: {
          code: 'not_found',
          message: 'Not found',
        },
      },
      404
    );
  });

  app.onError((error, context) => {
    const requestId = context.get('requestId');
    const requestLogger = context.get('logger') ?? logger;

    if (error instanceof AppError) {
      for (const [name, value] of Object.entries(error.headers)) {
        context.header(name, value);
      }
      requestLogger.warn({ err: error, status: error.status, code: error.code }, 'request.error');
      if (prefersHtmlError(context)) {
        return context.html(
          ErrorPage({
            status: error.status,
            code: error.code,
            chrome: errorPageChrome(context),
          }),
          error.status
        );
      }
      return context.json(errorEnvelope(error, requestId), error.status);
    }

    requestLogger.error({ err: error }, 'request.error');
    if (prefersHtmlError(context)) {
      return context.html(
        ErrorPage({
          status: 500,
          code: 'internal_error',
          chrome: errorPageChrome(context),
          requestId,
        }),
        500
      );
    }
    return context.json(internalErrorEnvelope(requestId), 500);
  });

  return app;
}

/**
 * Content negotiation is the whole fix: a browser navigation gets a page, an API client keeps its
 * envelope. `/v1` is excluded outright — that envelope is a published contract, whatever `Accept`
 * the caller happens to send.
 */
function prefersHtmlError(context: Context<{ Variables: AppVariables }>): boolean {
  const path = new URL(context.req.url).pathname;
  if (path === '/v1' || path.startsWith('/v1/')) {
    return false;
  }

  return (context.req.header('accept') ?? '')
    .split(',')
    .some((part) => part.trim().toLowerCase().startsWith('text/html'));
}

/**
 * Chrome follows the visitor, not the route: someone with a session keeps the navigation they were
 * using, so a dead link is a detour rather than an ejection. The cookie is a presentation hint
 * only — it grants nothing, and the links it produces enforce their own access.
 */
function errorPageChrome(context: Context<{ Variables: AppVariables }>): 'dashboard' | 'public' {
  return getCookie(context, SESSION_COOKIE_NAME) ? 'dashboard' : 'public';
}

function requestPrincipalFromContext(
  context: Context<{ Variables: AppVariables }>
): RequestPrincipalLog | undefined {
  const dashboardPrincipal = context.get('requestPrincipal');
  if (dashboardPrincipal) {
    return dashboardPrincipal;
  }

  const auth = context.get('auth');
  if (auth?.account?.id && auth.bot?.id) {
    return {
      kind: 'bot',
      account_id: auth.account.id,
      bot_id: auth.bot.id,
    };
  }

  return undefined;
}

function appOriginCsp(frameOrigin: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-src ${frameOrigin}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
