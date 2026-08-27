import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type { Account, CloudModule, QuotaAction } from '../extension/cloud-module.js';
import { createDefaultCloudModule } from '../extension/default-module.js';
import { AppError } from '../lib/errors.js';
import { dashboardPreviewFrameHeaders } from '../lib/frame-policy.js';
import { renderMarkdown } from '../lib/markdown.js';
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
  type DashboardArtifactDetail,
  type DashboardArtifactListItem,
  DashboardArtifactPage,
  type DashboardArtifactVersion,
  DashboardBotsPage,
  DashboardHomePage,
  type DashboardNavItem,
  type DashboardNotice,
  DashboardSettingsPage,
  DashboardTemplatesPage,
  type DashboardTemplateView,
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
}

interface ArtifactQueryRow {
  id: string;
  account_id: string;
  slug: string;
  type: 'markdown' | 'html';
  title: string;
  content: string;
  content_hash: string;
  version_num: number;
  updated_at: number;
  created_at: number;
  created_by_bot: string | null;
  bot_name: string | null;
  bot_byline: string | null;
  share_id: string | null;
  share_password_hash: string | null;
  share_expires_at: number | null;
  share_revoked_at: number | null;
  share_view_count: number | null;
  share_unique_viewer_count: number | null;
  share_last_viewed_at: number | null;
  share_created_at: number | null;
}

interface ShareAggregateRow {
  lifetime_views: number | string | null;
  previous_share_count: number | string | null;
}

interface VersionQueryRow {
  artifact_id: string;
  version_num: number;
  type: 'markdown' | 'html';
  title: string;
  content: string;
  content_hash: string;
  change_summary: string | null;
  restored_from_version: number | null;
  created_by_bot: string | null;
  created_at: number;
  bot_name: string | null;
}

interface TemplateQueryRow {
  id: string;
  account_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  type: 'markdown' | 'html';
  content: string;
  slots: string;
  created_from_artifact: string | null;
  created_at: number;
  updated_at: number;
}

interface ListFilters {
  q: string;
  botId: string;
  type: string;
  cursor: string;
}

const pageSize = 20;

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

    const filters = readListFilters(routeContext.req.query());
    const plan = await services.cloudModule.resolvePlan(accountToCloudAccount(session.account));
    const bots = await services.auth.listBots(session.account.id);
    const { artifacts, nextCursor } = await listArtifacts(
      services,
      session.account.id,
      filters,
      plan.artifact_retention_days
    );
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
    const artifact = await getArtifactDetail(
      services,
      session.account.id,
      artifactId,
      plan.artifact_retention_days
    );
    if (!artifact) {
      return routeContext.notFound();
    }
    const versions = await listVersions(services, artifactId);
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
    const artifact = await getArtifactDetail(
      services,
      session.account.id,
      routeContext.req.param('id'),
      null
    );
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
    const artifact = await getArtifactDetail(
      services,
      session.account.id,
      routeContext.req.param('id'),
      null
    );
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
        templates: await listTemplates(services, session.account.id),
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
    const artifact = await getArtifactDetail(
      services,
      session.account.id,
      routeContext.req.param('id'),
      null
    );
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
    const artifact = await getArtifactDetail(
      services,
      session.account.id,
      routeContext.req.param('id'),
      null
    );
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
    await updateAccountEmail(
      services,
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

function readListFilters(query: Record<string, string | string[]>): ListFilters {
  return {
    q: scalarQuery(query.q),
    botId: scalarQuery(query.bot),
    type: scalarQuery(query.type),
    cursor: scalarQuery(query.cursor),
  };
}

function scalarQuery(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

async function listArtifacts(
  services: HumanServices,
  accountId: string,
  filters: ListFilters,
  retentionDays: number | null
): Promise<{ artifacts: DashboardArtifactListItem[]; nextCursor: string | null }> {
  const cursor = decodeCursor(filters.cursor);
  const params: unknown[] = [accountId];
  const clauses = ['a.account_id = ?', 'a.deleted_at IS NULL'];
  if (filters.q) {
    clauses.push('(a.title LIKE ? OR a.slug LIKE ?)');
    const like = `%${escapeLike(filters.q)}%`;
    params.push(like, like);
  }
  if (filters.botId) {
    clauses.push('a.created_by_bot = ?');
    params.push(filters.botId);
  }
  if (filters.type === 'markdown' || filters.type === 'html') {
    clauses.push('a.type = ?');
    params.push(filters.type);
  }
  if (cursor) {
    clauses.push('(a.updated_at < ? OR (a.updated_at = ? AND a.id < ?))');
    params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  }
  params.push(pageSize + 1);

  const sql = artifactSelectSql(
    clauses.join(' AND '),
    'ORDER BY a.updated_at DESC, a.id DESC LIMIT ?'
  );
  const rows = await queryArtifacts(services.db, sql, params);
  const pageRows = rows.slice(0, pageSize);
  const artifacts = await Promise.all(
    pageRows.map((row) => artifactListItemFromRow(services, row, retentionDays))
  );
  const nextCursor = rows.length > pageSize ? encodeCursor(pageRows[pageRows.length - 1]) : null;
  return { artifacts, nextCursor };
}

async function getArtifactDetail(
  services: HumanServices,
  accountId: string,
  artifactId: string,
  retentionDays: number | null
): Promise<DashboardArtifactDetail | null> {
  const sql = artifactSelectSql(
    'a.account_id = ? AND a.id = ? AND a.deleted_at IS NULL',
    'LIMIT 1'
  );
  const rows = await queryArtifacts(services.db, sql, [accountId, artifactId]);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    ...(await artifactListItemFromRow(services, row, retentionDays)),
    content: row.content,
    contentHash: row.content_hash,
    versionNum: row.version_num,
    htmlPreview:
      row.type === 'markdown'
        ? renderMarkdown(row.content, { contentHash: row.content_hash })
        : null,
  };
}

async function listVersions(
  services: HumanServices,
  artifactId: string
): Promise<DashboardArtifactVersion[]> {
  const sql = `
    SELECT av.*, b.name AS bot_name
    FROM artifact_versions av
    LEFT JOIN bots b ON b.id = av.created_by_bot
    WHERE av.artifact_id = ?
    ORDER BY av.version_num DESC
  `;
  const rows =
    services.db.dialect === 'sqlite'
      ? (services.db.sqlite.prepare(sql).all(artifactId) as VersionQueryRow[])
      : (await services.db.pool.query<VersionQueryRow>(sql.replace('?', '$1'), [artifactId])).rows;
  return rows.map((row) => ({
    versionNum: row.version_num,
    type: row.type,
    title: row.title,
    content: row.content,
    contentHash: row.content_hash,
    changeSummary: row.change_summary,
    restoredFromVersion: row.restored_from_version,
    createdByBotName: row.bot_name,
    createdAt: row.created_at,
  }));
}

async function listTemplates(
  services: HumanServices,
  accountId: string
): Promise<DashboardTemplateView[]> {
  const sql = `
    SELECT *
    FROM templates
    WHERE account_id IS NULL OR account_id = ?
    ORDER BY account_id IS NOT NULL, name ASC
  `;
  const rows =
    services.db.dialect === 'sqlite'
      ? (services.db.sqlite.prepare(sql).all(accountId) as TemplateQueryRow[])
      : (await services.db.pool.query<TemplateQueryRow>(sql.replace('?', '$1'), [accountId])).rows;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    type: row.type,
    slots: parseTemplateSlots(row.slots),
    builtIn: row.account_id === null,
  }));
}

function artifactSelectSql(where: string, suffix: string): string {
  return `
    SELECT
      a.id, a.account_id, a.slug, a.type, a.title, a.content, a.content_hash,
      a.version_num, a.updated_at, a.created_at, a.created_by_bot,
      b.name AS bot_name, b.byline AS bot_byline,
      s.id AS share_id, s.password_hash AS share_password_hash,
      s.expires_at AS share_expires_at, s.revoked_at AS share_revoked_at,
      s.view_count AS share_view_count, s.unique_viewer_count AS share_unique_viewer_count,
      s.last_viewed_at AS share_last_viewed_at, s.created_at AS share_created_at
    FROM artifacts a
    LEFT JOIN bots b ON b.id = a.created_by_bot
    LEFT JOIN shares s ON s.artifact_id = a.id AND s.revoked_at IS NULL
    WHERE ${where}
    ${suffix}
  `;
}

async function queryArtifacts(
  db: DatabaseHandle,
  sql: string,
  params: unknown[]
): Promise<ArtifactQueryRow[]> {
  if (db.dialect === 'sqlite') {
    return db.sqlite.prepare(sql).all(...params) as ArtifactQueryRow[];
  }
  let index = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++index}`);
  return (await db.pool.query<ArtifactQueryRow>(pgSql, params)).rows;
}

async function artifactListItemFromRow(
  services: HumanServices,
  row: ArtifactQueryRow,
  retentionDays: number | null
): Promise<DashboardArtifactListItem> {
  const aggregate = await shareAggregate(services.db, row.id);
  const retentionExpiresAt =
    retentionDays === null ? null : row.updated_at + retentionDays * 86_400_000;
  const activeShare = row.share_id
    ? {
        id: row.share_id,
        url: `${services.config.baseUrl}/a/${row.share_id}`,
        passwordProtected: row.share_password_hash !== null,
        viewCount: row.share_view_count ?? 0,
        uniqueViewerCount: row.share_unique_viewer_count ?? 0,
        lastViewedAt: row.share_last_viewed_at,
        createdAt: row.share_created_at ?? row.created_at,
        revokedAt: row.share_revoked_at,
      }
    : null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    type: row.type,
    updatedAt: row.updated_at,
    botName: row.bot_name,
    botByline: row.bot_byline,
    activeShare,
    lifetimeViews: Number(aggregate.lifetime_views ?? activeShare?.viewCount ?? 0),
    previousShareCount: Number(aggregate.previous_share_count ?? 0),
    expiresAt: row.share_expires_at ?? retentionExpiresAt,
  };
}

async function shareAggregate(db: DatabaseHandle, artifactId: string): Promise<ShareAggregateRow> {
  const sql = `
    SELECT
      COALESCE(SUM(view_count), 0) AS lifetime_views,
      COALESCE(SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS previous_share_count
    FROM shares
    WHERE artifact_id = ?
  `;
  if (db.dialect === 'sqlite') {
    return db.sqlite.prepare(sql).get(artifactId) as ShareAggregateRow;
  }
  const result = await db.pool.query<ShareAggregateRow>(sql.replace('?', '$1'), [artifactId]);
  return result.rows[0] ?? { lifetime_views: 0, previous_share_count: 0 };
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

async function updateAccountEmail(
  services: HumanServices,
  accountId: string,
  email: string
): Promise<void> {
  const now = Date.now();
  if (services.db.dialect === 'sqlite') {
    services.db.sqlite
      .prepare('UPDATE accounts SET email = ?, updated_at = ? WHERE id = ?')
      .run(email, now, accountId);
    return;
  }
  await services.db.pool.query('UPDATE accounts SET email = $1, updated_at = $2 WHERE id = $3', [
    email,
    now,
    accountId,
  ]);
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
  versions: DashboardArtifactVersion[]
): { left: DashboardArtifactVersion; right: DashboardArtifactVersion } | null {
  const leftNum = Number(scalarQuery(query.left));
  const rightNum = Number(scalarQuery(query.right));
  if (!Number.isInteger(leftNum) || !Number.isInteger(rightNum)) {
    return null;
  }
  const left = versions.find((version) => version.versionNum === leftNum);
  const right = versions.find((version) => version.versionNum === rightNum);
  return left && right ? { left, right } : null;
}

function parseTemplateSlots(slotsJson: string): string[] {
  try {
    const value = JSON.parse(slotsJson) as Array<string | { name?: string }>;
    return value
      .map((slot) => (typeof slot === 'string' ? slot : (slot.name ?? '')))
      .filter((slot) => slot.length > 0);
  } catch {
    return [];
  }
}

function encodeCursor(row: ArtifactQueryRow | undefined): string | null {
  if (!row) {
    return null;
  }
  return Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id })).toString(
    'base64url'
  );
}

function decodeCursor(value: string): { updatedAt: number; id: string } | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.updatedAt === 'number' && typeof parsed.id === 'string') {
      return { updatedAt: parsed.updatedAt, id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '');
}

function downloadFilename(slug: string, type: string): string {
  return `${slug}.${type === 'markdown' ? 'md' : 'html'}`.replace(/[^a-zA-Z0-9._-]/g, '-');
}
