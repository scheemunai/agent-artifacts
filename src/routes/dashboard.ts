import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type { Account, CloudModule, QuotaAction } from '../extension/cloud-module.js';
import { createDefaultCloudModule } from '../extension/default-module.js';
import { AppError } from '../lib/errors.js';
import { dashboardPreviewFrameHeaders } from '../lib/frame-policy.js';
import type { Logger } from '../logger.js';
import { ArtifactService } from '../services/artifacts.js';
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
import { createMailService } from '../services/mail.js';
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
  type AuthPrincipal,
  createShareResponse,
  deleteShareResponse,
  patchShareResponse,
} from '../services/v1.js';
import {
  DashboardArtifactPage,
  DashboardBotsPage,
  DashboardHomePage,
  type DashboardNavItem,
  type DashboardNotice,
  DashboardSettingsPage,
  DashboardTemplatesPage,
} from '../ui/pages/dashboard.js';
import { SetupKeyPage, SetupPage, SetupUnavailablePage } from '../ui/pages/setup.js';
import {
  authErrorMessage,
  FixedWindowLimiter,
  type HumanApp,
  parseForm,
  registerAuthRoutes,
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
  artifacts: ArtifactService;
  dashboardReads: DashboardReadModelService;
}

export function registerHumanRoutes(app: HumanApp, context: HumanRoutesContext): void {
  if (!context.db) {
    return;
  }

  const cloudModule = context.cloudModule ?? createDefaultCloudModule(context.config);
  const services: HumanServices = {
    config: context.config,
    logger: context.logger,
    db: context.db,
    cloudModule,
    auth: new AuthService(context.db, context.config, context.logger),
    sessions: new SessionService(context.db, context.config),
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
    mail: createMailService(context.config, context.logger),
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
    const email = stringField(form, 'email');
    const botName = stringField(form, 'bot_name');
    const botByline = stringField(form, 'bot_byline');
    try {
      if (stringField(form, 'password').length < 8) {
        throw new AuthError(400, 'validation_failed', 'Password must be at least 8 characters');
      }
      if (stringField(form, 'password') !== stringField(form, 'password_confirm')) {
        throw new AuthError(400, 'validation_failed', 'Passwords do not match');
      }
      if (!botName) {
        throw new AuthError(400, 'validation_failed', 'Bot name is required');
      }
      const result = await services.auth.completeSetup({
        setupToken: stringField(form, 'setup_token'),
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
      return routeContext.html(
        SetupKeyPage({
          baseUrl: services.config.baseUrl,
          email: result.account.email,
          botName: result.bot.name,
          apiKey: result.apiKey,
        })
      );
    } catch (error) {
      return routeContext.html(
        SetupPage({
          baseUrl: services.config.baseUrl,
          error: authErrorMessage(error),
          email,
          botName,
          botByline,
        }),
        { status: htmlStatus(error) }
      );
    }
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
        baseUrl: services.config.baseUrl,
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
    return routeContext.html(
      DashboardBotsPage({
        account: accountView(session.account),
        bots: await services.auth.listBots(session.account.id),
        baseUrl: services.config.baseUrl,
        extensionNavItems: dashboardNavItems(services, session.account),
        notice: noticeFromQuery(routeContext.req.query('notice')),
      })
    );
  });

  app.get('/dashboard/templates', async (routeContext) => {
    const session = await requirePageSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    return routeContext.html(
      DashboardTemplatesPage({
        account: accountView(session.account),
        templates: await services.dashboardReads.listDashboardTemplates(session.account.id),
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
        extensionNavItems: dashboardNavItems(services, session.account),
        notice: noticeFromQuery(routeContext.req.query('notice')),
        error: routeContext.req.query('error') ?? undefined,
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
    try {
      if (!name) {
        throw new AuthError(400, 'validation_failed', 'Bot name is required');
      }
      await enforceQuota(services, accountToCloudAccount(session.account), { type: 'create_bot' });
      const { bot, apiKey } = await services.auth.createBot(
        accountToCloudAccount(session.account),
        name,
        byline
      );
      return routeContext.html(
        DashboardBotsPage({
          account: accountView(session.account),
          bots: await services.auth.listBots(session.account.id),
          baseUrl: services.config.baseUrl,
          extensionNavItems: dashboardNavItems(services, session.account),
          shownKey: { apiKey, botName: bot.name },
          notice: { tone: 'success', message: 'Bot created. Copy the key now.' },
        })
      );
    } catch (error) {
      return routeContext.html(
        DashboardBotsPage({
          account: accountView(session.account),
          bots: await services.auth.listBots(session.account.id),
          baseUrl: services.config.baseUrl,
          extensionNavItems: dashboardNavItems(services, session.account),
          error: authErrorMessage(error),
        }),
        { status: htmlStatus(error) }
      );
    }
  });

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
        stringField(form, 'confirm_name')
      );
      return routeContext.html(
        DashboardBotsPage({
          account: accountView(session.account),
          bots: await services.auth.listBots(session.account.id),
          baseUrl: services.config.baseUrl,
          extensionNavItems: dashboardNavItems(services, session.account),
          shownKey: { apiKey: result.apiKey, botName: result.bot.name },
          notice: { tone: 'success', message: 'Key regenerated. Old key is invalid now.' },
        })
      );
    } catch (error) {
      return routeContext.html(
        DashboardBotsPage({
          account: accountView(session.account),
          bots: await services.auth.listBots(session.account.id),
          baseUrl: services.config.baseUrl,
          extensionNavItems: dashboardNavItems(services, session.account),
          error: authErrorMessage(error),
        }),
        { status: htmlStatus(error) }
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
        stringField(form, 'confirm_name')
      );
      return routeContext.redirect('/dashboard/bots?notice=bot_revoked', 303);
    } catch (error) {
      return routeContext.html(
        DashboardBotsPage({
          account: accountView(session.account),
          bots: await services.auth.listBots(session.account.id),
          baseUrl: services.config.baseUrl,
          extensionNavItems: dashboardNavItems(services, session.account),
          error: authErrorMessage(error),
        }),
        { status: htmlStatus(error) }
      );
    }
  });

  app.post('/dashboard/api/artifacts/:id/restore', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    await services.artifacts.restoreVersion({
      account: accountToCloudAccount(session.account),
      artifactId: routeContext.req.param('id'),
      versionNum: Number(stringField(form, 'version')),
      changeSummary: `restored by ${session.account.email}`,
    });
    return routeContext.redirect(
      `/dashboard/artifacts/${routeContext.req.param('id')}?notice=artifact_restored`,
      303
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
    if (!artifact || stringField(form, 'confirm') !== artifact.title) {
      return routeContext.redirect(
        `/dashboard/artifacts/${routeContext.req.param('id')}?notice=confirmation_mismatch`,
        303
      );
    }
    await services.artifacts.softDeleteArtifact({
      account: accountToCloudAccount(session.account),
      artifactId: routeContext.req.param('id'),
    });
    return routeContext.redirect('/dashboard?notice=artifact_deleted', 303);
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
    if (!artifact || stringField(form, 'confirm') !== artifact.slug) {
      return routeContext.redirect(
        `/dashboard/artifacts/${routeContext.req.param('id')}?notice=confirmation_mismatch`,
        303
      );
    }
    await revokeDashboardShare(services, session, routeContext.req.param('id'));
    return routeContext.redirect(
      `/dashboard/artifacts/${routeContext.req.param('id')}?notice=share_revoked`,
      303
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
      return routeContext.redirect(
        `/dashboard/artifacts/${routeContext.req.param('id')}?promote_error=${encodeURIComponent(dashboardErrorMessage(error))}`,
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
    const account = await services.auth.findAccountById(session.account.id);
    if (
      !account?.passwordHash ||
      !(await verifyPasswordIfHashExists(
        account.passwordHash,
        stringField(form, 'current_password')
      ))
    ) {
      return routeContext.redirect(
        '/dashboard/settings?error=Current%20password%20is%20incorrect',
        303
      );
    }
    await services.auth.updateAccountEmail(
      session.account.id,
      normalizeEmail(stringField(form, 'new_email'))
    );
    return routeContext.redirect('/dashboard/settings?notice=email_updated', 303);
  });

  app.post('/dashboard/api/settings/password', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    try {
      if (stringField(form, 'new_password') !== stringField(form, 'confirm_password')) {
        throw new AuthError(400, 'validation_failed', 'Passwords do not match');
      }
      if (stringField(form, 'new_password').length < 8) {
        throw new AuthError(400, 'validation_failed', 'Password must be at least 8 characters');
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
      return routeContext.redirect(
        `/dashboard/settings?error=${encodeURIComponent(authErrorMessage(error))}`,
        303
      );
    }
  });

  app.post('/dashboard/api/settings/delete', async (routeContext) => {
    const session = await requireApiSession(routeContext, services);
    if (session instanceof Response) {
      return session;
    }
    const form = await parseForm(routeContext);
    if (normalizeEmail(stringField(form, 'confirm_email')) !== session.account.email) {
      return routeContext.redirect(
        '/dashboard/settings?error=Type%20the%20account%20email%20to%20confirm',
        303
      );
    }
    await services.auth.deleteAccountHard(session.account.id);
    services.sessions.clearSessionCookie(routeContext);
    return routeContext.redirect('/login', 303);
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
  return session;
}

function scalarQuery(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function dashboardPrincipal(account: AuthenticatedSession['account']): AuthPrincipal {
  return {
    account: accountToCloudAccount(account),
    bot: {
      id: 'dashboard',
      name: 'Dashboard',
      byline: null,
    },
    apiKeyHash: 'dashboard',
  };
}

async function createDashboardShare(
  services: HumanServices,
  session: AuthenticatedSession,
  artifactId: string,
  password: string
): Promise<void> {
  await createShareResponse({
    db: services.db,
    cloudModule: services.cloudModule,
    config: services.config,
    auth: dashboardPrincipal(session.account),
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
  await patchShareResponse({
    db: services.db,
    cloudModule: services.cloudModule,
    config: services.config,
    auth: dashboardPrincipal(session.account),
    idOrSlug: artifactId,
    passwordHash: await hashPassword(password),
  });
}

async function removeDashboardSharePassword(
  services: HumanServices,
  session: AuthenticatedSession,
  artifactId: string
): Promise<void> {
  await patchShareResponse({
    db: services.db,
    cloudModule: services.cloudModule,
    config: services.config,
    auth: dashboardPrincipal(session.account),
    idOrSlug: artifactId,
    passwordHash: null,
  });
}

async function revokeDashboardShare(
  services: HumanServices,
  session: AuthenticatedSession,
  artifactId: string
): Promise<void> {
  await deleteShareResponse({
    db: services.db,
    accountId: session.account.id,
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

function dashboardErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  return authErrorMessage(error);
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
    case 'template_promoted':
      return { tone: 'success', message: 'Template promoted.' };
    case 'password_required':
      return { tone: 'danger', message: 'Enter a password first.' };
    case 'confirmation_mismatch':
      return { tone: 'danger', message: 'Typed confirmation did not match.' };
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
