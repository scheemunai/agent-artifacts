import { Hono } from 'hono';
import { APP_VERSION } from '../lib/version.js';

export const healthRoute = new Hono();

healthRoute.get('/', (context) =>
  context.json({
    status: 'ok',
    version: APP_VERSION,
  })
);
