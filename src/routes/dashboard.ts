import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { nanoid } from 'nanoid';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type { Account, CloudModule, QuotaAction } from '../extension/cloud-module.js';
import { createDefaultCloudModule } from '../extension/default-module.js';
import { AppError } from '../lib/errors.js';
import { dashboardPreviewFrameHeaders } from '../lib/frame-policy.js';
import { renderMarkdown } from '../lib/markdown.js';
import type { Logger } from '../logger.js';
import { ArtifactService, type TemplatePreview } from '../services/artifacts.js';
import {
  AuthError,
  AuthService,
  accountToCloudAccount,
  hashPassword,
  normalizeEmail,
  verifyPasswordIfHashExists,
} from '../services/auth.js';
import {
  type DashboardArtifactVersionViewModel,
  DashboardReadModelService,
  readDashboardListFilters,
} from '../services/dashboard-read-models.js';
import { createMailService, type MailService } from '../services/mail.js';
import {
  type AuthenticatedSession,
  assertDashboardMutationOrigin,
  CsrfOriginError,
  originMismatchEnvelope,
  SESSION_COOKIE_NAME,
  SessionService,
} from '../services/sessions.js';
import { promoteArtifactToTemplate } from '../services/templates.js';
import {
  DashboardArtifactPage,
  DashboardBotsPage,
  type DashboardBotsPageProps,
  DashboardHomePage,
  type DashboardNavItem,
  type DashboardNotice,
  DashboardSettingsPage,
  DashboardTemplatesPage,
} from '../ui/pages/dashboard.js';
import {
  type SetupErrorField,
  SetupKeyHiddenPage,
  SetupKeyPage,
  SetupPage,
  SetupUnavailablePage,
} from '../ui/pages/setup.js';
import {
  authErrorMessage,
  FixedWindowLimiter,
  type HumanApp,
  parseForm,
  registerAuthRoutes,
  setDashboardRequestPrincipal,
  stringField,
} from './auth.js';

export interface HumanRoutesContext {
  config: AppConfig;
  logger: Logger;
  db?: DatabaseHandle;
  cloudModule?: CloudModule;
}

interface HumanServices {
  config: AppConfig;
  logger: Logger;
  db: DatabaseHandle;
  cloudModule: CloudModule;
  auth: AuthService;
  sessions: SessionService;
  mail: MailService;
  artifacts: ArtifactService;
  dashboardReads: DashboardReadModelService;
}

interface KeyReveal {
  accountId: string;
  apiKey: string;
  botName: string;
  createdAt: number;
}

const keyRevealTtlMs = 10 * 60 * 1000;

/**
 * Server-owned copy for a bots-page failure, addressed through the URL by a stable code.
 *
 * The message travels as a code rather than as text for the same reason `noticeFromQuery` does:
 * a message read out of the query string is a message anyone can put on this page by sending
 * someone a link, and "your account is suspended, call this number" renders just as well as
 * anything the product would say. Codes are a closed vocabulary; text is not.
 */
const BOT_FAILURE_COPY = {
  confirmation_mismatch: 'That did not match the bot name, so nothing was changed.',
  name_required: 'Bot name is required',
  quota_exceeded: 'This account has reached its bot limit.',
  unavailable: 'That did not go through, and nothing was changed. Try again.',
} as const;

type BotFailureCode = keyof typeof BOT_FAILURE_COPY;

function botFailureCode(error: unknown): BotFailureCode {
  if (error instanceof AuthError) {
    if (error.code === 'confirmation_mismatch') {
      return 'confirmation_mismatch';
    }
    if (error.code === 'quota_exceeded') {
      return 'quota_exceeded';
    }
  }
  return 'unavailable';
}

function botFailureMessage(code: string): string {
  return BOT_FAILURE_COPY[code as BotFailureCode] ?? BOT_FAILURE_COPY.unavailable;
}

/**
 * The settings failures, and the promote refusals, as codes.
 *
 * Same closed-vocabulary rule as `BOT_FAILURE_COPY`, applied to the two remaining places the
 * dashboard put a sentence in a query parameter. Specificity is kept where it is actionable —
 * "the passwords do not match" and "use at least 8 characters" are different instructions, and
 * collapsing them into one generic failure would have been a real loss — so the vocabulary has a
 * code per distinct remedy rather than a code per route.
 */
function settingsFailureCode(error: unknown): string {
  if (error instanceof AuthError) {
    if (error.code === 'invalid_password') {
      return 'password_incorrect';
    }
    if (error.code === 'email_conflict') {
      return 'email_in_use';
    }
    if (error.code === 'validation_failed') {
      return 'email_invalid';
    }
  }
  return 'settings_unavailable';
}

function promoteFailureCode(error: unknown): string {
  if (error instanceof AppError) {
    if (error.code === 'slug_conflict') {
      return 'slug_taken';
    }
    if (error.code === 'not_found') {
      return 'artifact_missing';
    }
    if (error.code === 'validation_failed') {
      return /slot/i.test(error.message) ? 'needs_a_slot' : 'markdown_only';
    }
  }
  return 'promote_unavailable';
}

/**
 * Rebuilds the keyed failure on the far side of the redirect, so it still lands on its subject.
 *
 * This is what makes Post/Redirect/Get affordable here: the error had an address before — the
 * create form's field, or one bot's row — and the address is what survives the trip, not the
 * sentence. `bot` names the row; `create_error` and `bot_error` name what went wrong.
 */
function botFailureProps(
  routeContext: Context
): Pick<DashboardBotsPageProps, 'createError' | 'botError'> {
  const createCode = scalarQuery(routeContext.req.query('create_error'));
  const botCode = scalarQuery(routeContext.req.query('bot_error'));
  const botId = scalarQuery(routeContext.req.query('bot'));

  return {
    ...(createCode
      ? {
          createError: {
            message: botFailureMessage(createCode),
            ...(createCode === 'name_required' ? { field: 'name' as const } : {}),
          },
        }
      : {}),
    ...(botCode && botId ? { botError: { botId, message: botFailureMessage(botCode) } } : {}),
  };
}

/**
 * Every answer to a mutation is somewhere to go — including the answers that failed.
 *
 * A mutation that responds with a document leaves the browser standing on the POST URL, so the
 * reader's next reflex (refresh, or back-then-forward) re-submits it. The success path already
 * understood this; the failure path did not, and the failure path is the dangerous half: a
 * destructive action with a correct typed confirmation, whose write failed for a transient
 * reason, is one refresh away from completing something the reader just watched not happen.
 */
async function answerWithRedirect(
  routeContext: Context,
  logger: Logger,
  outcome: { ok: string; failed: string },
  work: () => Promise<void>
): Promise<Response> {
  try {
    await work();
  } catch (error) {
    logger.error({ err: error, path: routeContext.req.path }, 'dashboard.mutation_failed');
    return routeContext.redirect(outcome.failed, 303);
  }
  return routeContext.redirect(outcome.ok, 303);
}

/**
 * A setup failure that knows which field caused it.
 *
 * `SetupPage` renders an error on its field when it is told which one — rung 2 of the attachment
 * ladder — and falls back to a card-level notice when it is not. Attribution is the route's to
 * give: it is the only party that knows which check failed. Extending `AuthError` keeps
 * `htmlStatus` and `authErrorMessage` working on it unchanged.
 */
class SetupFieldError extends AuthError {
  constructor(
    readonly field: SetupErrorField,
    message: string
  ) {
    super(400, 'validation_failed', message);
    this.name = 'SetupFieldError';
  }
}

function setupErrorField(error: unknown): SetupErrorField | undefined {
  if (error instanceof SetupFieldError) {
    return error.field;
  }
  // The one failure the service attributes for us: the token the operator just typed was rejected.
  // That is precisely the field whose value is now preserved, so the two belong together — a bad
  // token says so on the box holding it, with what was typed still visible to correct.
  return error instanceof AuthError && error.code === 'setup_token_required'
    ? 'setup_token'
    : undefined;
}

export function registerHumanRoutes(app: HumanApp, context: HumanRoutesContext): void {
  if (!context.db) {
    return;
  }

  const cloudModule = context.cloudModule ?? createDefaultCloudModule(context.config);
  const keyReveals = new Map<string, KeyReveal>();
  const mail = createMailService(context.config, context.logger);
  const services: HumanServices = {
    config: context.config,
    logger: context.logger,
    db: context.db,
    cloudModule,
    auth: new AuthService(context.db, context.config, context.logger),
    sessions: new SessionService(context.db, context.config),
    mail,
    artifacts: new ArtifactService({
      db: context.db,
      extension: cloudModule,
      baseUrl: context.config.baseUrl,
      logger: context.logger,
    }),
    dashboardReads: new DashboardReadModelService(context.db, { baseUrl: context.config.baseUrl }),
  };

  if (context.config.deployment === 'self-hosted') {
    void services.auth.ensureSetupToken().catch((error) => {
      context.logger.error({ err: error }, 'setup.token_init_failed');
    });
  }

  registerAuthRoutes(app, {
    config: context.config,
    logger: context.logger,
    auth: services.auth,
    sessions: services.sessions,
    mail: services.mail,
    magicEmailLimiter: new FixedWindowLimiter(),
    magicIpLimiter: new FixedWindowLimiter(),
    passwordLimiter: new FixedWindowLimiter(),
  });

  app.get('/setup', async (routeContext) => {
    if (services.config.deployment !== 'self-hosted') {
      return routeContext.redirect('/login', 302);
    }
    if ((await services.auth.countAccounts()) > 0) {
      return routeContext.html(SetupUnavailablePage(), 403);
    }

    await services.auth.ensureSetupToken();
    return routeContext.html(SetupPage({ baseUrl: services.config.baseUrl }));
  });

  app.post('/setup', async (routeContext) => {
    if (services.config.deployment !== 'self-hosted') {
      return routeContext.redirect('/login', 302);
    }
    const form = await parseForm(routeContext);
    const setupToken = stringField(form, 'setup_token');
    const email = stringField(form, 'email');
    const botName = stringField(form, 'bot_name');
    const botByline = stringField(form, 'bot_byline');
    try {
      if (stringField(form, 'password').length < 8) {
        throw new SetupFieldError('password', 'Password must be at least 8 characters');
      }
      if (stringField(form, 'password') !== stringField(form, 'password_confirm')) {
        throw new SetupFieldError('password_confirm', 'Passwords do not match');
      }
      if (!botName) {
        throw new SetupFieldError('bot_name', 'Bot name is required');
      }
      const result = await services.auth.completeSetup({
        setupToken,
        email,
        password: stringField(form, 'password'),
        botName,
        botByline,
      });
      services.sessions.setSessionCookie(
        routeContext,
        result.session.cookieValue,
        result.session.expiresAt
      );
      setDashboardRequestPrincipal(routeContext, result.account.id);
      const revealId = storeKeyReveal(keyReveals, {
        accountId: result.account.id,
        botName: result.bot.name,
        apiKey: result.apiKey,
      });
      return routeContext.redirect(`/setup/key?reveal=${encodeURIComponent(revealId)}`, 303);
    } catch (error) {
      return routeContext.html(
        SetupPage({
          baseUrl: services.config.baseUrl,
          error: authErrorMessage(error),
          errorField: setupErrorField(error),
          // A one-time value the operator reads out of the server boot log. Clearing it on a
          // validation slip costs them a trip back to the terminal, which makes it the worst
          // field on this form to drop — including when it is the field that was wrong.
          setupToken,
          email,
          botName,
          botByline,
        }),
        { status: htmlStatus(error) }
      );
    }
  });

  app.get('/setup/key', async (routeContext) => {
    if (services.config.deployment !== 'self-hosted') {
      return routeContext.redirect('/login', 302);
    }
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const reveal = consumeKeyReveal(
      keyReveals,
      session.account.id,
      scalarQuery(routeContext.req.query('reveal'))
    );
    if (reveal) {
      return routeContext.html(
        SetupKeyPage({
          baseUrl: services.config.baseUrl,
          email: session.account.email,
          botName: reveal.botName,
          apiKey: reveal.apiKey,
        })
      );
    }

    const latestBot = await services.auth.getLatestBot(session.account.id);
    return routeContext.html(
      SetupKeyHiddenPage({
        baseUrl: services.config.baseUrl,
        email: session.account.email,
        botName: latestBot?.name,
        apiKeyLast4: latestBot?.apiKeyLast4,
      })
    );
  });

  app.get('/dashboard', async (routeContext) => {
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }

    const filters = readDashboardListFilters(routeContext.req.query());
    const plan = await services.cloudModule.resolvePlan(accountToCloudAccount(session.account));
    const bots = await services.auth.listBots(session.account.id);
    const { artifacts, nextCursor } = await services.dashboardReads.listDashboardArtifacts({
      accountId: session.account.id,
      filters,
      retentionDays: plan.artifact_retention_days,
    });
    return routeContext.html(
      DashboardHomePage({
        account: accountView(session.account),
        artifacts,
        bots,
        latestBot: bots[0] ?? null,
        baseUrl: services.config.baseUrl,
        extensionNavItems: dashboardNavItems(services, session.account),
        filters: { ...filters, nextCursor },
        notice: noticeFromQuery(routeContext.req.query('notice')),
      })
    );
  });

  app.get('/dashboard/artifacts/:id', async (routeContext) => {
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const artifactId = routeContext.req.param('id');
    const plan = await services.cloudModule.resolvePlan(accountToCloudAccount(session.account));
    const artifact = await services.dashboardReads.getDashboardArtifactDetail({
      accountId: session.account.id,
      artifactId,
      retentionDays: plan.artifact_retention_days,
    });
    if (!artifact) {
      return routeContext.notFound();
    }
    const versions = await services.dashboardReads.listDashboardArtifactVersions(artifactId);
    const diff = resolveDiff(routeContext.req.query(), versions);
    return routeContext.html(
      DashboardArtifactPage({
        account: accountView(session.account),
        artifact,
        versions,
        diff,
        extensionNavItems: dashboardNavItems(services, session.account),
        notice: noticeFromQuery(routeContext.req.query('notice')),
        promoteError: routeContext.req.query('promote_error') ?? null,
      })
    );
  });

  app.get('/dashboard/artifacts/:id/frame', async (routeContext) => {
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const artifact = await services.dashboardReads.getDashboardArtifactDetail({
      accountId: session.account.id,
      artifactId: routeContext.req.param('id'),
      retentionDays: null,
    });
    if (artifact?.type !== 'html') {
      return routeContext.notFound();
    }
    return routeContext.body(artifact.content, 200, dashboardPreviewFrameHeaders(services.config));
  });

  app.get('/dashboard/artifacts/:id/download', async (routeContext) => {
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const artifact = await services.dashboardReads.getDashboardArtifactDetail({
      accountId: session.account.id,
      artifactId: routeContext.req.param('id'),
      retentionDays: null,
    });
    if (!artifact) {
      return routeContext.notFound();
    }
    routeContext.header(
      'Content-Type',
      artifact.type === 'markdown' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8'
    );
    routeContext.header(
      'Content-Disposition',
      `attachment; filename="${downloadFilename(artifact.slug, artifact.type)}"`
    );
    return routeContext.body(artifact.content);
  });

  app.get('/dashboard/bots', async (routeContext) => {
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const revealParam = scalarQuery(routeContext.req.query('reveal'));
    const reveal = consumeKeyReveal(keyReveals, session.account.id, revealParam);
    const noticeParam = routeContext.req.query('notice');
    const shownKey = reveal
      ? {
          apiKey: reveal.apiKey,
          botName: reveal.botName,
          origin:
            noticeParam === 'bot_key_regenerated' ? ('regenerated' as const) : ('created' as const),
        }
      : undefined;
    return routeContext.html(
      DashboardBotsPage({
        account: accountView(session.account),
        bots: await services.auth.listBots(session.account.id),
        baseUrl: services.config.baseUrl,
        extensionNavItems: dashboardNavItems(services, session.account),
        shownKey,
        // The failure survived the redirect as a code; the copy is the server's.
        ...botFailureProps(routeContext),
        /*
         * When there is a key on screen, its card carries the outcome that produced it — naming the
         * bot, and warning in the regenerate case that a live key just stopped working. A page-level
         * banner would only repeat that sentence several hundred pixels above the thing it is about,
         * which is the shape this replaced. A spent reveal has nothing to attach to, so it stays.
         */
        notice: shownKey
          ? undefined
          : revealParam
            ? {
                tone: 'warn',
                message: 'That key was shown once and is now hidden. Regenerate it if you lost it.',
              }
            : noticeFromQuery(noticeParam),
      })
    );
  });

  app.get('/dashboard/templates', async (routeContext) => {
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const templates = await services.dashboardReads.listDashboardTemplates(session.account.id);
    return routeContext.html(
      DashboardTemplatesPage({
        account: accountView(session.account),
        templates,
        previewTemplate: await getTemplatePreview(
          services,
          session.account.id,
          scalarQuery(routeContext.req.query('preview'))
        ),
        extensionNavItems: dashboardNavItems(services, session.account),
        notice: noticeFromQuery(routeContext.req.query('notice')),
      })
    );
  });

  app.get('/dashboard/settings', async (routeContext) => {
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    return routeContext.html(
      DashboardSettingsPage({
        account: accountView(session.account),
        deployment: services.config.deployment,
        extensionNavItems: dashboardNavItems(services, session.account),
        notice: noticeFromQuery(routeContext.req.query('notice')),
      })
    );
  });

  app.use('/dashboard/api/*', async (routeContext, next) => {
    try {
      assertDashboardMutationOrigin(routeContext, services.config);
    } catch (error) {
      if (error instanceof CsrfOriginError) {
        return routeContext.json(originMismatchEnvelope(), 403);
      }
      throw error;
    }
    await next();
  });

  app.post('/dashboard/api/logout', async (routeContext) => {
    await services.sessions.deleteCookieSession(getCookie(routeContext, SESSION_COOKIE_NAME));
    services.sessions.clearSessionCookie(routeContext);
    return routeContext.redirect('/login', 303);
  });

  app.post('/dashboard/api/bots', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    const name = stringField(form, 'name');
    const byline = stringField(form, 'byline');
    if (!name) {
      // A field caused it, so the field carries it — but by way of the page, not in place. The
      // code survives the redirect and `Input error` puts the ring, `aria-invalid` and
      // `aria-describedby` back on the field when the page renders.
      return routeContext.redirect('/dashboard/bots?create_error=name_required', 303);
    }
    try {
      await enforceQuota(services, accountToCloudAccount(session.account), { type: 'create_bot' });
      const { bot, apiKey } = await services.auth.createBot(
        accountToCloudAccount(session.account),
        name,
        byline
      );
      const revealId = storeKeyReveal(keyReveals, {
        accountId: session.account.id,
        botName: bot.name,
        apiKey,
      });
      return routeContext.redirect(
        `/dashboard/bots?reveal=${encodeURIComponent(revealId)}&notice=bot_created`,
        303
      );
    } catch (error) {
      services.logger.error({ err: error }, 'dashboard.bot_create_failed');
      return routeContext.redirect(`/dashboard/bots?create_error=${botFailureCode(error)}`, 303);
    }
  });

  /**
   * Typed confirmations all post `confirm`.
   *
   * Three spellings for one concept — `confirm`, `confirm_name`, `confirm_email` — were three
   * chances for a confirmation to be silently skipped by a form that named the field the other
   * way. The server still validates the typed value on every one of these routes; the dialog's
   * disabled button is a courtesy, not a control.
   */
  app.post('/dashboard/api/bots/:id/regenerate', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    try {
      const result = await services.auth.regenerateBotKey(
        session.account.id,
        routeContext.req.param('id'),
        stringField(form, 'confirm')
      );
      const revealId = storeKeyReveal(keyReveals, {
        accountId: session.account.id,
        botName: result.bot.name,
        apiKey: result.apiKey,
      });
      return routeContext.redirect(
        `/dashboard/bots?reveal=${encodeURIComponent(revealId)}&notice=bot_key_regenerated`,
        303
      );
    } catch (error) {
      services.logger.error({ err: error }, 'dashboard.bot_mutation_failed');
      return routeContext.redirect(
        `/dashboard/bots?bot_error=${botFailureCode(error)}&bot=${encodeURIComponent(routeContext.req.param('id'))}`,
        303
      );
    }
  });

  app.post('/dashboard/api/bots/:id/revoke', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    try {
      await services.auth.revokeBotKey(
        session.account.id,
        routeContext.req.param('id'),
        stringField(form, 'confirm')
      );
      return routeContext.redirect('/dashboard/bots?notice=bot_revoked', 303);
    } catch (error) {
      services.logger.error({ err: error }, 'dashboard.bot_mutation_failed');
      return routeContext.redirect(
        `/dashboard/bots?bot_error=${botFailureCode(error)}&bot=${encodeURIComponent(routeContext.req.param('id'))}`,
        303
      );
    }
  });

  app.post('/dashboard/api/artifacts/:id/restore', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    const artifactPath = `/dashboard/artifacts/${routeContext.req.param('id')}`;
    return answerWithRedirect(
      routeContext,
      services.logger,
      {
        ok: `${artifactPath}?notice=artifact_restored`,
        failed: `${artifactPath}?notice=artifact_restore_failed`,
      },
      async () => {
        await services.artifacts.restoreVersion({
          account: accountToCloudAccount(session.account),
          artifactId: routeContext.req.param('id'),
          versionNum: Number(stringField(form, 'version')),
          changeSummary: `restored by ${session.account.email}`,
        });
      }
    );
  });

  app.post('/dashboard/api/artifacts/:id/delete', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const artifact = await services.dashboardReads.getDashboardArtifactDetail({
      accountId: session.account.id,
      artifactId: routeContext.req.param('id'),
      retentionDays: null,
    });
    const form = await parseForm(routeContext);
    // Gone already is not a mismatch, and sending the reader to the detail page of something that
    // no longer exists would answer one dead end with another.
    if (!artifact) {
      return routeContext.redirect('/dashboard?notice=artifact_missing', 303);
    }
    if (stringField(form, 'confirm') !== artifact.title) {
      return routeContext.redirect(
        `/dashboard/artifacts/${routeContext.req.param('id')}?notice=delete_confirm_mismatch`,
        303
      );
    }
    return answerWithRedirect(
      routeContext,
      services.logger,
      {
        ok: '/dashboard?notice=artifact_deleted',
        failed: `/dashboard/artifacts/${routeContext.req.param('id')}?notice=artifact_delete_failed`,
      },
      async () => {
        await services.artifacts.softDeleteArtifact({
          account: accountToCloudAccount(session.account),
          artifactId: routeContext.req.param('id'),
        });
      }
    );
  });

  app.post('/dashboard/api/artifacts/:id/share', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    await createDashboardShare(
      services,
      session,
      routeContext.req.param('id'),
      stringField(form, 'password')
    );
    return routeContext.redirect(
      `/dashboard/artifacts/${routeContext.req.param('id')}?notice=share_created`,
      303
    );
  });

  app.post('/dashboard/api/artifacts/:id/share/password', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    const password = stringField(form, 'password');
    if (!password) {
      return routeContext.redirect(
        `/dashboard/artifacts/${routeContext.req.param('id')}?notice=password_required`,
        303
      );
    }
    await setDashboardSharePassword(services, session, routeContext.req.param('id'), password);
    return routeContext.redirect(
      `/dashboard/artifacts/${routeContext.req.param('id')}?notice=share_password_changed`,
      303
    );
  });

  app.post('/dashboard/api/artifacts/:id/share/password/remove', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    await removeDashboardSharePassword(services, session, routeContext.req.param('id'));
    return routeContext.redirect(
      `/dashboard/artifacts/${routeContext.req.param('id')}?notice=share_password_removed`,
      303
    );
  });

  app.post('/dashboard/api/artifacts/:id/share/revoke', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    const artifact = await services.dashboardReads.getDashboardArtifactDetail({
      accountId: session.account.id,
      artifactId: routeContext.req.param('id'),
      retentionDays: null,
    });
    const sharePath = `/dashboard/artifacts/${routeContext.req.param('id')}`;
    if (!artifact) {
      return routeContext.redirect('/dashboard?notice=artifact_missing', 303);
    }
    if (stringField(form, 'confirm') !== artifact.slug) {
      return routeContext.redirect(`${sharePath}?notice=share_revoke_confirm_mismatch`, 303);
    }
    return answerWithRedirect(
      routeContext,
      services.logger,
      {
        ok: `${sharePath}?notice=share_revoked`,
        failed: `${sharePath}?notice=share_revoke_failed`,
      },
      async () => {
        await revokeDashboardShare(services, session, routeContext.req.param('id'));
      }
    );
  });

  app.post('/dashboard/api/artifacts/:id/promote-template', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    try {
      await promoteTemplate(services, session.account.id, routeContext.req.param('id'), {
        name: stringField(form, 'name'),
        slug: stringField(form, 'slug'),
        description: stringField(form, 'description'),
      });
      return routeContext.redirect('/dashboard/templates?notice=template_promoted', 303);
    } catch (error) {
      services.logger.error({ err: error }, 'dashboard.promote_failed');
      return routeContext.redirect(
        `/dashboard/artifacts/${routeContext.req.param('id')}?promote_error=${promoteFailureCode(error)}`,
        303
      );
    }
  });

  app.post('/dashboard/api/settings/email', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    if (services.config.deployment === 'cloud') {
      try {
        const issued = await services.auth.requestEmailChange(
          session.account.id,
          stringField(form, 'new_email')
        );
        await services.mail.sendMagicLink({ to: issued.email, url: issued.url });
        return routeContext.redirect('/dashboard/settings?notice=email_change_link_sent', 303);
      } catch (error) {
        services.logger.error({ err: error }, 'dashboard.email_change_failed');
        return routeContext.redirect(
          `/dashboard/settings?notice=${settingsFailureCode(error)}`,
          303
        );
      }
    }

    const account = await services.auth.findAccountById(session.account.id);
    if (
      !account?.passwordHash ||
      !(await verifyPasswordIfHashExists(
        account.passwordHash,
        stringField(form, 'current_password')
      ))
    ) {
      return routeContext.redirect('/dashboard/settings?notice=password_incorrect', 303);
    }
    return answerWithRedirect(
      routeContext,
      services.logger,
      {
        ok: '/dashboard/settings?notice=email_updated',
        failed: '/dashboard/settings?notice=email_change_failed',
      },
      async () => {
        await services.auth.updateAccountEmail(
          session.account.id,
          normalizeEmail(stringField(form, 'new_email'))
        );
      }
    );
  });

  app.post('/dashboard/api/settings/password', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    if (services.config.deployment === 'cloud') {
      return routeContext.redirect('/dashboard/settings?notice=password_cloud_unavailable', 303);
    }
    const form = await parseForm(routeContext);
    try {
      if (stringField(form, 'new_password') !== stringField(form, 'confirm_password')) {
        return routeContext.redirect('/dashboard/settings?notice=password_mismatch', 303);
      }
      if (stringField(form, 'new_password').length < 8) {
        return routeContext.redirect('/dashboard/settings?notice=password_too_short', 303);
      }
      await services.auth.changePassword(
        session.account.id,
        stringField(form, 'current_password'),
        stringField(form, 'new_password')
      );
      const nextSession = await services.sessions.createSession(session.account.id);
      await services.sessions.deleteAllAccountSessions(session.account.id, nextSession.tokenHash);
      services.sessions.setSessionCookie(
        routeContext,
        nextSession.cookieValue,
        nextSession.expiresAt
      );
      return routeContext.redirect('/dashboard/settings?notice=password_changed', 303);
    } catch (error) {
      services.logger.error({ err: error }, 'dashboard.password_change_failed');
      return routeContext.redirect(`/dashboard/settings?notice=${settingsFailureCode(error)}`, 303);
    }
  });

  app.post('/dashboard/api/settings/delete', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    if (normalizeEmail(stringField(form, 'confirm')) !== session.account.email) {
      return routeContext.redirect('/dashboard/settings?notice=account_confirm_mismatch', 303);
    }
    return answerWithRedirect(
      routeContext,
      services.logger,
      { ok: '/login', failed: '/dashboard/settings?notice=account_delete_failed' },
      async () => {
        await services.auth.deleteAccountHard(session.account.id);
        services.sessions.clearSessionCookie(routeContext);
      }
    );
  });
}

async function requirePageSession(
  routeContext: Context,
  services: HumanServices
): Promise<AuthenticatedSession | Response> {
  const session = await services.sessions.validateContext(routeContext);
  if (!session) {
    return routeContext.redirect('/login', 302);
  }
  setDashboardRequestPrincipal(routeContext, session.account.id);
  return session;
}

async function requireApiSession(
  routeContext: Context,
  services: HumanServices
): Promise<AuthenticatedSession | Response> {
  const session = await services.sessions.validateContext(routeContext);
  if (!session) {
    return routeContext.json(
      { error: { code: 'unauthorized', message: 'Log in to continue' } },
      401
    );
  }
  setDashboardRequestPrincipal(routeContext, session.account.id);
  return session;
}

function scalarQuery(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function storeKeyReveal(
  reveals: Map<string, KeyReveal>,
  input: Omit<KeyReveal, 'createdAt'>
): string {
  pruneKeyReveals(reveals);
  const id = nanoid(24);
  reveals.set(id, { ...input, createdAt: Date.now() });
  return id;
}

function consumeKeyReveal(
  reveals: Map<string, KeyReveal>,
  accountId: string,
  revealId: string
): KeyReveal | null {
  if (!revealId) {
    return null;
  }
  pruneKeyReveals(reveals);
  const reveal = reveals.get(revealId);
  reveals.delete(revealId);
  if (!reveal || reveal.accountId !== accountId) {
    return null;
  }
  return reveal;
}

function pruneKeyReveals(reveals: Map<string, KeyReveal>): void {
  const cutoff = Date.now() - keyRevealTtlMs;
  for (const [id, reveal] of reveals.entries()) {
    if (reveal.createdAt < cutoff) {
      reveals.delete(id);
    }
  }
}

async function getTemplatePreview(
  services: HumanServices,
  accountId: string,
  templateId: string
): Promise<(TemplatePreview & { htmlPreview: string | null }) | null> {
  const template = await services.artifacts.getTemplatePreview(accountId, templateId);
  if (!template) {
    return null;
  }

  return {
    ...template,
    htmlPreview:
      template.type === 'markdown' ? renderMarkdown(template.content, { headingOffset: 1 }) : null,
  };
}

async function createDashboardShare(
  services: HumanServices,
  session: AuthenticatedSession,
  artifactId: string,
  password: string
): Promise<void> {
  await services.artifacts.createShare({
    account: accountToCloudAccount(session.account),
    idOrSlug: artifactId,
    ...(password ? { passwordHash: await hashPassword(password) } : {}),
  });
}

async function setDashboardSharePassword(
  services: HumanServices,
  session: AuthenticatedSession,
  artifactId: string,
  password: string
): Promise<void> {
  await services.artifacts.setSharePassword({
    account: accountToCloudAccount(session.account),
    idOrSlug: artifactId,
    passwordHash: await hashPassword(password),
  });
}

async function removeDashboardSharePassword(
  services: HumanServices,
  session: AuthenticatedSession,
  artifactId: string
): Promise<void> {
  await services.artifacts.setSharePassword({
    account: accountToCloudAccount(session.account),
    idOrSlug: artifactId,
    passwordHash: null,
  });
}

async function revokeDashboardShare(
  services: HumanServices,
  session: AuthenticatedSession,
  artifactId: string
): Promise<void> {
  await services.artifacts.revokeShare({
    account: accountToCloudAccount(session.account),
    idOrSlug: artifactId,
  });
}

async function promoteTemplate(
  services: HumanServices,
  accountId: string,
  artifactId: string,
  input: { name: string; slug: string; description: string }
): Promise<void> {
  await promoteArtifactToTemplate({
    db: services.db,
    accountId,
    artifactId,
    name: input.name,
    slug: input.slug,
    description: input.description || null,
  });
}

async function enforceQuota(
  services: HumanServices,
  account: Account,
  action: QuotaAction
): Promise<void> {
  const decision = await services.cloudModule.checkQuota(account, action);
  if (!decision.allow) {
    throw new AuthError(403, 'quota_exceeded', decision.message, { code: decision.code });
  }
}

function htmlStatus(error: unknown): 400 | 403 | 409 | 429 | 500 {
  if (error instanceof AuthError) {
    if ([400, 403, 409, 429].includes(error.status)) {
      return error.status as 400 | 403 | 409 | 429;
    }
  }
  return 500;
}

function dashboardNavItems(
  services: HumanServices,
  account: AuthenticatedSession['account']
): DashboardNavItem[] {
  return services.cloudModule.navItems?.(accountToCloudAccount(account)) ?? [];
}

function accountView(account: AuthenticatedSession['account']) {
  return { id: account.id, email: account.email };
}

function noticeFromQuery(value: string | undefined): DashboardNotice | undefined {
  switch (value) {
    case 'bot_created':
      return { tone: 'success', message: 'Bot created. Copy the key now.' };
    case 'bot_key_regenerated':
      return { tone: 'success', message: 'Key regenerated. Old key is invalid now.' };
    case 'bot_revoked':
      return { tone: 'success', message: 'Bot key revoked.' };
    case 'artifact_restored':
      return { tone: 'success', message: 'Artifact restored as a new version.' };
    case 'artifact_deleted':
      return { tone: 'success', message: 'Artifact deleted.' };
    case 'share_created':
      return { tone: 'success', message: 'Share link created.' };
    case 'share_revoked':
      return { tone: 'success', message: 'Share link revoked.' };
    case 'share_password_changed':
      return { tone: 'success', message: 'Share password updated.' };
    case 'share_password_removed':
      return { tone: 'success', message: 'Share password removed.' };
    case 'password_changed':
      return { tone: 'success', message: 'Password changed and other sessions signed out.' };
    case 'email_updated':
      return { tone: 'success', message: 'Email updated.' };
    case 'email_change_link_sent':
      return { tone: 'success', message: 'Check the new email address to confirm the change.' };
    case 'template_promoted':
      return { tone: 'success', message: 'Template promoted.' };
    case 'password_required':
      return { tone: 'danger', message: 'Enter a password first.' };

    /*
     * B-G6. One string served every confirmation in the product — "Typed confirmation did not
     * match." — so on a page carrying three of them the reader could not tell which one had
     * failed, and none of them said what was still true afterwards. Each site now names its own
     * subject and its own consequence, which is the part that answers "so what happened?".
     */
    case 'delete_confirm_mismatch':
      return {
        tone: 'danger',
        message: 'The title you typed did not match, so the artifact was not deleted.',
      };
    case 'share_revoke_confirm_mismatch':
      return {
        tone: 'danger',
        message: 'The slug you typed did not match, so the share link is still live.',
      };
    case 'account_confirm_mismatch':
      return {
        tone: 'danger',
        message: 'The email you typed did not match, so the account was not deleted.',
      };

    /*
     * The transient half. These say what did not happen rather than what went wrong, because the
     * reader cannot act on the cause and the only thing they need to know is whether the thing
     * they asked for took effect.
     */
    case 'artifact_delete_failed':
      return {
        tone: 'danger',
        message: 'That delete did not go through — the artifact is still here.',
      };
    case 'share_revoke_failed':
      return {
        tone: 'danger',
        message: 'That revoke did not go through — the link is still live.',
      };
    case 'artifact_restore_failed':
      return {
        tone: 'danger',
        message: 'That restore did not go through — the current version is unchanged.',
      };
    case 'account_delete_failed':
      return { tone: 'danger', message: 'That did not go through — the account was not deleted.' };
    case 'artifact_missing':
      return { tone: 'warn', message: 'That artifact is no longer here.' };

    /* Settings failures. Codes, not sentences, for the reason above the vocabulary. */
    case 'password_incorrect':
      return { tone: 'danger', message: 'That current password is not right.' };
    case 'password_mismatch':
      return { tone: 'danger', message: 'The new passwords do not match.' };
    case 'password_too_short':
      return { tone: 'danger', message: 'Use at least 8 characters for the new password.' };
    case 'password_cloud_unavailable':
      return {
        tone: 'info',
        message: 'Cloud accounts sign in by email link, so there is no password to change.',
      };
    case 'email_in_use':
      return { tone: 'danger', message: 'That email address is already in use.' };
    case 'email_invalid':
      return { tone: 'danger', message: 'Enter a valid email address.' };
    case 'email_change_failed':
      return { tone: 'danger', message: 'That email change did not go through.' };
    case 'settings_unavailable':
      return { tone: 'danger', message: 'That did not go through, and nothing was changed.' };
    default:
      return undefined;
  }
}

function resolveDiff(
  query: Record<string, string | string[]>,
  versions: DashboardArtifactVersionViewModel[]
): { left: DashboardArtifactVersionViewModel; right: DashboardArtifactVersionViewModel } | null {
  const leftNum = Number(scalarQuery(query.left));
  const rightNum = Number(scalarQuery(query.right));
  if (!Number.isInteger(leftNum) || !Number.isInteger(rightNum)) {
    return null;
  }
  const left = versions.find((version) => version.versionNum === leftNum);
  const right = versions.find((version) => version.versionNum === rightNum);
  return left && right ? { left, right } : null;
}

function downloadFilename(slug: string, type: string): string {
  return `${slug}.${type === 'markdown' ? 'md' : 'html'}`.replace(/[^a-zA-Z0-9._-]/g, '-');
}
