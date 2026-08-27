import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { AppConfig } from './config.js';
import type { DatabaseHandle } from './db/client.js';
import type { CloudModule } from './extension/cloud-module.js';
import { AppError, errorEnvelope, internalErrorEnvelope } from './lib/errors.js';
import type { Logger } from './logger.js';
import { registerHumanRoutes } from './routes/dashboard.js';
import { healthRoute } from './routes/health.js';
import { registerPublicRoutes } from './routes/public.js';
import { registerV1Routes } from './routes/v1/index.js';
import { createWebRoute } from './routes/web.js';

interface AppVariables {
  requestId: string;
  logger: Logger;
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

    const contentType = context.res.headers.get('content-type');
    if (contentType?.includes('text/html')) {
      context.header('Content-Security-Policy', appOriginCsp(config.frameOrigin));
      context.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      context.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    }
  });

  // Route mounting order is deliberate: static/literal routes before future parameterized routers.
  app.get('/assets/*', serveStatic({ root: './public' }));
  app.route('/healthz', healthRoute);
  const routesContext = {
    config,
    logger,
    ...(db ? { db } : {}),
    ...(cloudModule ? { cloudModule } : {}),
  };
  registerV1Routes(app, routesContext);
  registerPublicRoutes(app, routesContext);
  registerHumanRoutes(app, routesContext);
  app.route('/', createWebRoute(config));

  app.notFound((context) =>
    context.json(
      {
        error: {
          code: 'not_found',
          message: 'Not found',
        },
      },
      404
    )
  );

  app.onError((error, context) => {
    const requestId = context.get('requestId');
    const requestLogger = context.get('logger') ?? logger;

    if (error instanceof AppError) {
      for (const [name, value] of Object.entries(error.headers)) {
        context.header(name, value);
      }
      requestLogger.warn({ err: error, status: error.status, code: error.code }, 'request.error');
      return context.json(errorEnvelope(error, requestId), error.status);
    }

    requestLogger.error({ err: error }, 'request.error');
    return context.json(internalErrorEnvelope(requestId), 500);
  });

  return app;
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
