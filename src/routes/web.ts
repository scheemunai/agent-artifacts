import { type Context, Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { publicArtifactFrameHeaders } from '../lib/frame-policy.js';
import { clientIp, FixedWindowLimiter, rateLimitKey } from '../lib/rate-limit.js';
import type { Logger } from '../logger.js';
import { getLiveArtifactMeta, heroArtifactUrl } from '../services/live-artifact-meta.js';
import { SESSION_COOKIE_NAME, unsignedSessionToken } from '../services/sessions.js';
import { selfHostedEntryPath } from '../services/setup-state.js';
import { loadStarterTemplates, type StarterTemplate } from '../services/templates.js';
import {
  createWaitlistService,
  WaitlistError,
  type WaitlistService,
} from '../services/waitlist.js';
import { FrameDocument } from '../ui/pages/frame-document.js';
import { HOME_WAITLIST_ACTION, HomePage, type HomeWaitlist } from '../ui/pages/home.js';
import { LEGAL_SLUGS, LegalPage, legalDocument } from '../ui/pages/legal.js';
import { LoginPlaceholderPage, SetupPlaceholderPage } from '../ui/pages/placeholder.js';
import { StyleGuidePage } from '../ui/pages/style-guide.js';
import { TemplateDetailPage, TemplatesPage } from '../ui/pages/templates.js';

/**
 * Loaded on first request and kept for the life of the process.
 *
 * Module scope rather than per-route-factory because the manifest is SHIPPED BYTES — it cannot
 * change under a running process, and both faces of this module serve the same gallery from it.
 * Re-reading eight files per request would cost something and buy nothing.
 */
let cachedStarterTemplates: StarterTemplate[] | null = null;

function starterTemplates(): StarterTemplate[] {
  cachedStarterTemplates ??= loadStarterTemplates();
  return cachedStarterTemplates;
}

const WAITLIST_ERRORS: Record<string, string> = {
  invalid_email: 'That does not look like an email address. Check it and try again.',
  not_configured: 'The waitlist is not open here yet.',
  upstream: 'We could not add you just now. Try again in a moment.',
  rate_limited: 'That is a lot of tries. Give it a few minutes and try again.',
};

export interface WebRouteOptions {
  /** Injected in tests so a signup can be exercised without reaching Resend. */
  waitlist?: WaitlistService;
}

/** The request-scoped logger `createApp` sets, so a signup logs with its own request id. */
interface WebVariables {
  logger?: Logger;
}

export function createWebRoute(
  config: AppConfig,
  logger: Logger,
  options: WebRouteOptions = {}
): Hono<{ Variables: WebVariables }> {
  const web = new Hono<{ Variables: WebVariables }>();
  // Null when this deployment has no hero artifact configured. Both the meta lookup and the page
  // take that as "say nothing" rather than falling back to a share that lives somewhere else.
  const artifactUrl = heroArtifactUrl(config.baseUrl, config.heroArtifactPath);
  const waitlist = options.waitlist ?? createWaitlistService(config, logger);
  // Per-address and per-IP, because they fail differently: one address hammered from many hosts is
  // someone trying to get a stranger mailed, and one host submitting many addresses is a bot
  // filling the audience with junk. A single counter cannot see both.
  const emailLimiter = new FixedWindowLimiter();
  const ipLimiter = new FixedWindowLimiter();

  web.get('/', (context) => {
    // Checked BEFORE the self-hosted redirect: the flag is an explicit statement about what this
    // host's front door says, and a deployment mode should not be able to override it.
    if (config.comingSoon) {
      return context.html(comingSoonPage(config, context, waitlist, {}));
    }

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
        ...(config.githubUrl ? { githubUrl: config.githubUrl } : {}),
        heroArtifactUrl: artifactUrl,
        // Filled by the boot-time refresher in src/index.ts. Null until then, null forever when
        // nothing is polling, and the meta strip stays silent rather than showing a stale claim.
        liveArtifact: getLiveArtifactMeta(artifactUrl),
      })
    );
  });

  // MOUNTED ONLY WHILE THE FLAG IS ON, so a launched instance answers 404 here rather than
  // rendering a "launching soon" page to anyone who POSTs at the live site. The route belongs to
  // the pre-launch homepage; when that page is not being served, neither is its form action.
  if (!config.comingSoon) {
    registerRemainingWebRoutes(web, config);
    return web;
  }

  // A GET here is a refresh, a bookmark, or a crawler following a form action. None of them are
  // asking for a page — the form lives on the homepage — so this is a redirect rather than a 404.
  web.get(HOME_WAITLIST_ACTION, (context) => context.redirect('/', 302));

  web.post(HOME_WAITLIST_ACTION, async (context) => {
    const form = await context.req.parseBody();
    const raw = form.email;
    const email = (Array.isArray(raw) ? String(raw[0] ?? '') : String(raw ?? '')).trim();
    const requestLogger = context.get('logger') ?? logger;

    if (!config.rateLimitsDisabled) {
      const emailAllowed = emailLimiter.check(
        rateLimitKey(['waitlist-email', email.toLowerCase()]),
        5,
        60 * 60 * 1000
      );
      const ipAllowed = ipLimiter.check(
        rateLimitKey(['waitlist-ip', clientIp(context, config.trustProxy)]),
        20,
        60 * 60 * 1000
      );
      if (!emailAllowed || !ipAllowed) {
        return context.html(
          comingSoonPage(config, context, waitlist, {
            state: 'error',
            email,
            error: WAITLIST_ERRORS.rate_limited,
          }),
          429
        );
      }
    }

    try {
      const outcome = await waitlist.subscribe(email);
      requestLogger.info({ outcome }, 'waitlist.signup');
      // 200 rather than a redirect: the confirmation names the address it was given, and a
      // redirect would either lose that or put an email address in a query string and a server log.
      return context.html(comingSoonPage(config, context, waitlist, { state: 'joined', email }));
    } catch (error) {
      const reason = error instanceof WaitlistError ? error.reason : 'upstream';
      if (reason !== 'invalid_email') {
        requestLogger.warn({ err: error, reason }, 'waitlist.signup_failed');
      }
      return context.html(
        comingSoonPage(config, context, waitlist, {
          state: 'error',
          email,
          error: WAITLIST_ERRORS[reason] ?? WAITLIST_ERRORS.upstream,
        }),
        reason === 'invalid_email' ? 400 : 503
      );
    }
  });

  registerRemainingWebRoutes(web, config);
  return web;
}

/**
 * The routes both faces of this module serve. Factored out so the early return above cannot ship a
 * build where turning the flag off also takes the style guide with it.
 */
function registerRemainingWebRoutes(
  web: Hono<{ Variables: WebVariables }>,
  config: AppConfig
): void {
  /**
   * The legal pages, served by BOTH faces of this module and in every deployment mode.
   *
   * Unconditional on purpose. Stripe Checkout renders a terms-of-service checkbox linking here, and
   * a customer has to be able to open that link before paying — so these cannot be behind the
   * coming-soon flag, and they cannot 404 on a host that happens to be pre-launch. A legal link
   * that 404s at the moment of payment is worse than having no link.
   */
  for (const slug of LEGAL_SLUGS) {
    web.get(`/${slug}`, (context) => {
      const document = legalDocument(slug);
      return document ? context.html(LegalPage({ document })) : context.notFound();
    });
  }

  /**
   * The public template gallery.
   *
   * Pre-login and pre-account by design, for the same reason the legal pages are: this is where
   * somebody deciding whether to sign up finds out what an agent can actually make for them. It
   * reads the shipped manifest rather than the database — no account, no seeding, no dependency to
   * buy nothing, and the manifest is what seeds the built-ins so the two cannot disagree.
   *
   * Loaded once. The manifest is shipped bytes; re-reading eight files per request would be a cost
   * with no upside.
   */
  web.get('/templates', (context) =>
    context.html(TemplatesPage({ templates: starterTemplates() }))
  );

  web.get('/templates/:slug', (context) => {
    const template = starterTemplates().find(
      (candidate) => candidate.slug === context.req.param('slug')
    );
    return template ? context.html(TemplateDetailPage({ template })) : context.notFound();
  });

  /**
   * The gallery's live preview, in the same sandbox a published artifact renders in.
   *
   * Same shell and the same headers as `/a/:share_id/frame`, deliberately: a preview that renders
   * under a softer policy than the real thing is a preview that can look right while the artifact
   * looks wrong. This content is ours and is already served to any authenticated agent through
   * `GET /v1/templates/:slug`, so nothing new is exposed — only the rendering posture is reused.
   */
  web.get('/templates/:slug/frame', (context) => {
    const template = starterTemplates().find(
      (candidate) => candidate.slug === context.req.param('slug')
    );
    if (template?.type !== 'html') {
      return context.notFound();
    }
    return context.body(
      FrameDocument({ content: template.content, title: template.name }),
      200,
      publicArtifactFrameHeaders({ config: config })
    );
  });

  web.get('/style-guide', (context) => context.html(StyleGuidePage()));
  web.get('/setup', (context) => context.html(SetupPlaceholderPage()));
  web.get('/login', (context) => context.html(LoginPlaceholderPage()));
}

/**
 * One renderer for all four coming-soon states, so the page's chrome cannot drift between the form,
 * its rejection, its confirmation, and the version with no audience behind it.
 */
function comingSoonPage(
  config: AppConfig,
  context: Context,
  waitlist: WaitlistService,
  state: Omit<HomeWaitlist, 'enabled'>
): ReturnType<typeof HomePage> {
  return HomePage({
    baseUrl: config.baseUrl,
    comingSoon: true,
    authenticated: hasSignedSessionCookie(
      getCookie(context, SESSION_COOKIE_NAME),
      config.sessionSecret
    ),
    ...(config.githubUrl ? { githubUrl: config.githubUrl } : {}),
    // The pre-launch page carries the same footer link, so it needs the same answer: a host with no
    // hero artifact must not offer one here either.
    heroArtifactUrl: heroArtifactUrl(config.baseUrl, config.heroArtifactPath),
    waitlist: { enabled: waitlist.enabled, ...state },
  });
}

function hasSignedSessionCookie(cookieValue: string | undefined, secret: string): boolean {
  return cookieValue ? Boolean(unsignedSessionToken(cookieValue, secret)) : false;
}
