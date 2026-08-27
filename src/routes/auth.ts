import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { clientIp } from '../lib/rate-limit.js';
import type { Logger } from '../logger.js';
import { AuthError, type AuthService, normalizeEmail } from '../services/auth.js';
import { hasConfiguredMail, type MailService } from '../services/mail.js';
import { SESSION_COOKIE_NAME, type SessionService } from '../services/sessions.js';
import { LoginPage, MagicLinkExpiredPage, MagicLinkInterstitialPage } from '../ui/pages/login.js';

export interface HumanVariables {
  requestId: string;
  logger: Logger;
}

export type HumanApp = Hono<{ Variables: HumanVariables }>;

export interface FixedWindowLimiterOptions {
  now?: () => number;
}

export class FixedWindowLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private readonly now: () => number;

  constructor(options: FixedWindowLimiterOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  check(key: string, limit: number, windowMs: number): boolean {
    const now = this.now();
    const existing = this.entries.get(key);
    if (!existing || existing.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (existing.count >= limit) {
      return false;
    }
    existing.count += 1;
    return true;
  }
}

export interface AuthRoutesOptions {
  config: AppConfig;
  logger: Logger;
  auth: AuthService;
  sessions: SessionService;
  mail: MailService;
  magicEmailLimiter: FixedWindowLimiter;
  magicIpLimiter: FixedWindowLimiter;
  passwordLimiter: FixedWindowLimiter;
}

const genericPasswordError = 'Email or password is incorrect';

export function registerAuthRoutes(app: HumanApp, options: AuthRoutesOptions): void {
  app.get('/login', async (context) => {
    const session = await options.sessions.validateContext(context);
    if (session) {
      return context.redirect('/dashboard', 302);
    }

    const setupRedirect = await redirectToSetupIfFreshSelfHosted(options, context);
    if (setupRedirect) {
      return setupRedirect;
    }

    const requestedMode = context.req.query('mode');
    const mode =
      options.config.deployment === 'cloud' || requestedMode === 'magic' ? 'magic' : 'password';
    const mailAvailable =
      options.config.deployment === 'cloud' || hasConfiguredMail(options.config);
    return context.html(
      LoginPage({
        mode: mode === 'magic' && mailAvailable ? 'magic' : 'password',
        email: context.req.query('email') ?? '',
        mailAvailable,
      })
    );
  });

  app.post('/login', async (context) => {
    const form = await parseForm(context);
    const email = stringField(form, 'email');
    const requestedMode = stringField(form, 'mode');
    const mode =
      options.config.deployment === 'cloud' || requestedMode === 'magic' ? 'magic' : 'password';
    const mailAvailable =
      options.config.deployment === 'cloud' || hasConfiguredMail(options.config);

    if (mode === 'magic' && mailAvailable) {
      return requestMagicLink(context, options, email);
    }

    if (!options.config.rateLimitsDisabled) {
      const allowed = options.passwordLimiter.check(
        `password:${clientIp(context, options.config.trustProxy)}`,
        10,
        15 * 60 * 1000
      );
      if (!allowed) {
        return context.html(
          LoginPage({
            mode: 'password',
            email,
            error: 'Too many attempts. Try again later.',
            mailAvailable,
          }),
          429
        );
      }
    }

    const result = await options.auth.loginWithPassword(email, stringField(form, 'password'));
    if (!result) {
      return context.html(
        LoginPage({ mode: 'password', email, error: genericPasswordError, mailAvailable }),
        401
      );
    }

    await options.sessions.deleteCookieSession(getCookie(context, SESSION_COOKIE_NAME));
    options.sessions.setSessionCookie(
      context,
      result.session.cookieValue,
      result.session.expiresAt
    );
    return context.redirect('/dashboard', 303);
  });

  app.get('/auth/verify', (context) => {
    const token = context.req.query('token') ?? '';
    return context.html(MagicLinkInterstitialPage({ token }));
  });

  app.post('/auth/verify', async (context) => {
    const form = await parseForm(context);
    const token = stringField(form, 'token');
    const result = await options.auth.consumeMagicLink(token);
    if (!result.ok || !result.session) {
      return context.html(MagicLinkExpiredPage({ email: result.email ?? '' }), 200);
    }

    await options.sessions.deleteCookieSession(getCookie(context, SESSION_COOKIE_NAME));
    options.sessions.setSessionCookie(
      context,
      result.session.cookieValue,
      result.session.expiresAt
    );
    return context.redirect('/dashboard', 303);
  });
}

async function requestMagicLink(
  context: Context,
  options: AuthRoutesOptions,
  emailInput: string
): Promise<Response> {
  const email = normalizeEmail(emailInput);
  if (!options.config.rateLimitsDisabled) {
    const emailAllowed = options.magicEmailLimiter.check(`magic-email:${email}`, 5, 60 * 60 * 1000);
    const ipAllowed = options.magicIpLimiter.check(
      `magic-ip:${clientIp(context, options.config.trustProxy)}`,
      10,
      60 * 60 * 1000
    );
    if (!emailAllowed || !ipAllowed) {
      return context.html(
        LoginPage({
          mode: 'magic',
          email,
          error: 'Too many links requested. Try again later.',
          mailAvailable: true,
        }),
        429
      );
    }
  }

  try {
    const issued = await options.auth.requestMagicLink(email);
    if (issued.url) {
      await options.mail.sendMagicLink({ to: issued.email, url: issued.url });
    }
  } catch (error) {
    const logger = context.get('logger') ?? options.logger;
    logger.warn({ err: error }, 'auth.magic_link_failed');
    return context.html(
      LoginPage({
        mode: 'magic',
        email,
        error: 'We could not send that link. Try again in a moment.',
        mailAvailable: true,
      }),
      503
    );
  }

  return context.html(LoginPage({ mode: 'magic', email, sent: true, mailAvailable: true }));
}

async function redirectToSetupIfFreshSelfHosted(
  options: AuthRoutesOptions,
  context: Context
): Promise<Response | null> {
  if (options.config.deployment !== 'self-hosted') {
    return null;
  }
  if ((await options.auth.countAccounts()) === 0) {
    await options.auth.ensureSetupToken();
    return context.redirect('/setup', 302);
  }
  return null;
}

export async function parseForm(context: Context): Promise<Record<string, string>> {
  const body = await context.req.parseBody();
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      Array.isArray(value) ? String(value[0] ?? '') : String(value ?? ''),
    ])
  );
}

export function stringField(form: Record<string, string>, name: string): string {
  return form[name]?.trim() ?? '';
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    return error.message;
  }
  return 'Something went wrong. Try again.';
}
