import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { SESSION_COOKIE_NAME, unsignedSessionToken } from '../services/sessions.js';
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

function selfHostedEntryPath(config: AppConfig): '/setup' | '/login' {
  if (config.databaseUrl) {
    return '/login';
  }

  return sqliteHasAccounts(config.sqlitePath) ? '/login' : '/setup';
}

function sqliteHasAccounts(sqlitePath: string): boolean {
  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    const row = sqlite.prepare('SELECT count(*) AS count FROM accounts').get() as
      | { count: number }
      | undefined;
    return Number(row?.count ?? 0) > 0;
  } catch {
    return false;
  } finally {
    sqlite?.close();
  }
}

function hasSignedSessionCookie(cookieValue: string | undefined, secret: string): boolean {
  return cookieValue ? Boolean(unsignedSessionToken(cookieValue, secret)) : false;
}
