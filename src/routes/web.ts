import { Hono } from 'hono';
import type { AppConfig } from '../config.js';
import {
  CloudPlaceholderPage,
  LoginPlaceholderPage,
  SetupPlaceholderPage,
} from '../ui/pages/placeholder.js';
import { StyleGuidePage } from '../ui/pages/style-guide.js';

export function createWebRoute(config: AppConfig): Hono {
  const web = new Hono();

  web.get('/', (context) => {
    if (config.deployment === 'self-hosted') {
      return context.redirect('/setup', 302);
    }

    return context.html(CloudPlaceholderPage());
  });

  web.get('/style-guide', (context) => context.html(StyleGuidePage()));
  web.get('/setup', (context) => context.html(SetupPlaceholderPage()));
  web.get('/login', (context) => context.html(LoginPlaceholderPage()));

  return web;
}
