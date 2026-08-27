import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { SESSION_COOKIE_NAME, unsignedSessionToken } from '../services/sessions.js';
import { selfHostedEntryPath } from '../services/setup-state.js';
import { HomePage } from '../ui/pages/home.js';
import { LoginPlaceholderPage, SetupPlaceholderPage } from '../ui/pages/placeholder.js';
import { StyleGuidePage } from '../ui/pages/style-guide.js';

export function createWebRoute(config: AppConfig): Hono {
  const web = new Hono();

  web.get('/', (context) => {
    if (config.deployment === 'self-hosted') {
      return context.redirect(selfHostedEntryPath(config), 302);
    }

    return context.html(
      HomePage({
        baseUrl: config.baseUrl,
        authenticated: hasSignedSessionCookie(
          getCookie(context, SESSION_COOKIE_NAME),
          config.sessionSecret
        ),
      })
    );
  });

  web.get('/style-guide', (context) => context.html(StyleGuidePage()));
  web.get('/setup', (context) => context.html(SetupPlaceholderPage()));
  web.get('/login', (context) => context.html(LoginPlaceholderPage()));

  return web;
}

function hasSignedSessionCookie(cookieValue: string | undefined, secret: string): boolean {
  return cookieValue ? Boolean(unsignedSessionToken(cookieValue, secret)) : false;
}
