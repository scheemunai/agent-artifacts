import type { Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { clientIp, FixedWindowLimiter, rateLimitKey } from '../lib/rate-limit.js';
import type { Logger } from '../logger.js';
import { AuthError, type AuthService, normalizeEmail } from '../services/auth.js';
import { hasConfiguredMail, type MailService } from '../services/mail.js';
import { SESSION_COOKIE_NAME, type SessionService } from '../services/sessions.js';
import {
  EmailChangeExpiredPage,
  EmailChangeInterstitialPage,
  LoginPage,
  MagicLinkInterstitialPage,
  MagicLinkInvalidPage,
} from '../ui/pages/login.js';

export interface HumanVariables {
  requestId: string;
  logger: Logger;
  requestPrincipal?: DashboardRequestPrincipalLog;
}

export type HumanApp = Hono<{ Variables: HumanVariables }>;

export { FixedWindowLimiter };

interface DashboardRequestPrincipalLog {
  kind: 'bot' | 'dashboard';
  account_id: string;
  bot_id?: string;
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

    // A request for a sign-in mode this instance does not offer used to fall through to the password
    // branch with an empty password, so it answered 401 with a credential error: three false claims
    // at once — that credentials were checked, that they were wrong, and nothing about the real
    // cause. Nothing in the product links here (the form only offers magic when mail is configured),
    // so this is a direct or bookmarked POST, and it deserves the true answer rather than a silence.
    if (mode === 'magic' && !mailAvailable) {
      return context.html(
        LoginPage({ mode: 'password', email, mailAvailable, magicUnavailable: true }),
        400
      );
    }

    if (!options.config.rateLimitsDisabled) {
      const allowed = options.passwordLimiter.check(
        rateLimitKey(['password', clientIp(context, options.config.trustProxy)]),
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
    setDashboardRequestPrincipal(context, result.account.id);
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
      return context.html(MagicLinkInvalidPage({ email: result.email ?? '' }), 200);
    }

    await options.sessions.deleteCookieSession(getCookie(context, SESSION_COOKIE_NAME));
    options.sessions.setSessionCookie(
      context,
      result.session.cookieValue,
      result.session.expiresAt
    );
    if (result.account) {
      setDashboardRequestPrincipal(context, result.account.id);
    }
    return context.redirect('/dashboard', 303);
  });

  app.get('/auth/change-email', (context) => {
    const token = context.req.query('token') ?? '';
    return context.html(EmailChangeInterstitialPage({ token }));
  });

  app.post('/auth/change-email', async (context) => {
    const form = await parseForm(context);
    const token = stringField(form, 'token');
    const result = await options.auth.consumeEmailChangeToken(token);
    if (!result.ok || !result.session || !result.account) {
      return context.html(EmailChangeExpiredPage({ email: result.email ?? '' }), 200);
    }

    await options.sessions.deleteCookieSession(getCookie(context, SESSION_COOKIE_NAME));
    options.sessions.setSessionCookie(
      context,
      result.session.cookieValue,
      result.session.expiresAt
    );
    setDashboardRequestPrincipal(context, result.account.id);
    return context.redirect('/dashboard/settings?notice=email_updated', 303);
  });
}

async function requestMagicLink(
  context: Context,
  options: AuthRoutesOptions,
  emailInput: string
): Promise<Response> {
  const email = normalizeEmail(emailInput);
  if (!options.config.rateLimitsDisabled) {
    const emailAllowed = options.magicEmailLimiter.check(
      rateLimitKey(['magic-email', email]),
      5,
      60 * 60 * 1000
    );
    const ipAllowed = options.magicIpLimiter.check(
      rateLimitKey(['magic-ip', clientIp(context, options.config.trustProxy)]),
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

export function setDashboardRequestPrincipal(context: Context, accountId: string): void {
  context.set('requestPrincipal', { kind: 'dashboard', account_id: accountId });
}
