import type { Context, Env, Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type { CloudModule } from '../extension/cloud-module.js';
import { createDefaultCloudModule } from '../extension/default-module.js';
import {
  FRAME_CONTENT_TYPE,
  frameHeaders,
  publicArtifactFrameHeaders,
} from '../lib/frame-policy.js';
import { isSandboxHostRequest } from '../lib/host-guard.js';
import { generateCachedOgImage } from '../lib/og.js';
import {
  clientIp,
  InMemoryRateLimitStore,
  rateLimitDecision,
  rateLimitKey,
  retryAfterResponseHeaders,
} from '../lib/rate-limit.js';
import type { Logger } from '../logger.js';
import { ServiceError, toErrorEnvelope } from '../services/errors.js';
import {
  SHARE_ID_PATTERN,
  VIEWER_COOKIE_MAX_AGE_SECONDS,
  type ViewerContentResult,
  ViewerService,
} from '../services/viewer.js';
import { FrameDocument, FrameTerminalDocument } from '../ui/pages/frame-document.js';
import { ShareTerminalPage } from '../ui/pages/share-terminal.js';
import { ViewerPage } from '../ui/pages/viewer.js';

export interface PublicRoutesContext {
  config: AppConfig;
  logger: Logger;
  db?: DatabaseHandle;
  cloudModule?: CloudModule;
}

interface PublicRouteVariables {
  requestId: string;
  logger: Logger;
}

type PublicContext = Context<{ Variables: PublicRouteVariables }>;

const PUBLIC_RATE_LIMIT = 120;
const PUBLIC_RATE_WINDOW_MS = 60 * 1000;
const VERIFY_RATE_LIMIT = 10;
const VERIFY_RATE_WINDOW_MS = 15 * 60 * 1000;

export function registerPublicRoutes<E extends Env>(app: Hono<E>, ctx: PublicRoutesContext): void {
  const cloudModule = ctx.cloudModule ?? createDefaultCloudModule(ctx.config);
  const viewer = ctx.db
    ? new ViewerService({
        db: ctx.db,
        config: ctx.config,
        cloudModule,
        logger: ctx.logger,
      })
    : null;
  const rateLimitStore = new InMemoryRateLimitStore();

  app.use('/a/*', async (context, next) => {
    if (ctx.config.rateLimitsDisabled) {
      await next();
      return;
    }

    const decision = rateLimitDecision(
      rateLimitStore,
      rateLimitKey(['public', clientIp(context, ctx.config.trustProxy)]),
      { limit: PUBLIC_RATE_LIMIT, windowMs: PUBLIC_RATE_WINDOW_MS }
    );
    if (!decision.allowed) {
      return rateLimited(context as unknown as PublicContext, decision.retryAfter);
    }

    await next();
  });

  app.on(['GET', 'HEAD'], '/a/:share_id/content', async (context) => {
    if (!viewer) {
      return context.json(toErrorEnvelope(new ServiceError(404, 'not_found', 'Not found')), 404);
    }

    return handleJson(context as unknown as PublicContext, async () => {
      const shareId = context.req.param('share_id');
      const url = new URL(context.req.url);
      const versionNum = parseVersionParam(url);
      const content = await viewer.getContent(shareId, {
        ...(versionNum ? { versionNum } : {}),
        viewerToken: shareToken(context as unknown as PublicContext),
      });
      const etag = quoteEtag(content.contentHash);
      context.header('ETag', etag);
      context.header(
        'Cache-Control',
        versionNum ? 'private, max-age=86400, immutable' : 'private, max-age=10, must-revalidate'
      );

      if (etagMatches(context.req.header('if-none-match'), etag)) {
        return context.body(null, 304);
      }

      // PRD §8.6: a view is counted only on a successful GET of the live content. HEAD serves
      // the same headers but must never count and must never mint an aa_viewer cookie, or every
      // link checker and uptime probe would inflate both view_count and unique_viewer_count.
      const poll = url.searchParams.get('poll') === '1';
      const countsView = context.req.method === 'GET' && !poll && !versionNum;
      if (countsView) {
        const viewerId = viewerCookie(context as unknown as PublicContext, viewer, ctx.config);
        await viewer.recordView({
          shareId: content.shareId,
          artifactId: content.artifactId,
          accountId: content.accountId,
          viewerId,
        });
      }

      return context.json(contentPayload(content), 200);
    });
  });

  app.post('/a/:share_id/verify-password', async (context) => {
    if (!viewer) {
      return context.json(toErrorEnvelope(new ServiceError(404, 'not_found', 'Not found')), 404);
    }

    const shareId = context.req.param('share_id');
    if (!SHARE_ID_PATTERN.test(shareId)) {
      return context.json(toErrorEnvelope(new ServiceError(404, 'not_found', 'Not found')), 404);
    }

    if (!ctx.config.rateLimitsDisabled) {
      const decision = rateLimitDecision(
        rateLimitStore,
        rateLimitKey(['verify', clientIp(context, ctx.config.trustProxy), shareId]),
        { limit: VERIFY_RATE_LIMIT, windowMs: VERIFY_RATE_WINDOW_MS }
      );
      if (!decision.allowed) {
        return rateLimited(context as unknown as PublicContext, decision.retryAfter);
      }
    }

    return handleJson(context as unknown as PublicContext, async () => {
      const body = await parseJsonBody(context as unknown as PublicContext);
      if (!body || typeof body.password !== 'string' || body.password.length === 0) {
        throw new ServiceError(400, 'validation_failed', 'password is required', {
          field: 'password',
        });
      }

      const success = await viewer.verifyPassword(shareId, body.password);
      setCookie(context as unknown as PublicContext, 'aa_sa', success.viewerToken, {
        path: `/a/${shareId}`,
        maxAge: 900,
        httpOnly: true,
        sameSite: 'Lax',
        secure: ctx.config.secureCookies,
      });

      return context.json(
        {
          ok: true,
          viewer_token: success.viewerToken,
          expires_at: new Date(success.expiresAt).toISOString(),
        },
        200
      );
    });
  });

  app.on(['GET', 'HEAD'], '/a/:share_id/download', async (context) => {
    if (!viewer) {
      return context.json(toErrorEnvelope(new ServiceError(404, 'not_found', 'Not found')), 404);
    }

    return handleBinary(context as unknown as PublicContext, async () => {
      const versionNum = parseVersionParam(new URL(context.req.url));
      const content = await viewer.getDownload(context.req.param('share_id'), {
        ...(versionNum ? { versionNum } : {}),
        viewerToken: shareToken(context as unknown as PublicContext),
      });
      const extension = content.type === 'markdown' ? 'md' : 'html';
      const filename = `${content.slug}${versionNum ? `-v${versionNum}` : ''}.${extension}`;
      return context.body(content.content, 200, {
        'Content-Type':
          content.type === 'markdown' ? 'text/markdown; charset=utf-8' : FRAME_CONTENT_TYPE,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': versionNum ? 'private, max-age=86400, immutable' : 'private, max-age=10',
      });
    });
  });

  app.on(['GET', 'HEAD'], '/a/:share_id/og.png', async (context) => {
    if (!viewer) {
      return context.text('Not found', 404);
    }

    return handleBinary(context as unknown as PublicContext, async () => {
      const og = await viewer.getOgModel(context.req.param('share_id'));
      const png = await generateCachedOgImage({
        shareId: og.shareId,
        contentHash: og.contentHash,
        title: og.title,
        botName: og.bot?.name ?? null,
        botByline: og.bot?.byline ?? null,
      });

      return new Response(png as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    });
  });

  app.on(['GET', 'HEAD'], '/a/:share_id/frame', async (context) => {
    const frameContext = context as unknown as PublicContext;
    const redirectUrl = frameRedirectUrl(frameContext, ctx.config);
    if (redirectUrl) {
      return context.redirect(redirectUrl, 301);
    }

    if (!viewer) {
      return frameTerminal(
        frameContext,
        ctx.config,
        new ServiceError(404, 'not_found', 'Not found')
      );
    }

    try {
      const url = new URL(context.req.url);
      const versionNum = parseVersionParam(url);
      const token = shareToken(frameContext) ?? url.searchParams.get('t');
      const content = await viewer.getContent(context.req.param('share_id'), {
        ...(versionNum ? { versionNum } : {}),
        viewerToken: token,
      });

      if (content.type !== 'html') {
        throw new ServiceError(404, 'not_found', 'Not found');
      }

      // `content.content` is passed through untouched — FrameDocument only supplies the document
      // shell an agent fragment cannot supply for itself (doctype, charset, viewport, a baseline
      // that any agent style overrides), and returns a whole document unchanged. Header policy is
      // exactly what it was.
      return context.body(
        FrameDocument({ content: content.content, title: content.title }),
        200,
        frameHeaders({
          config: ctx.config,
          variant: 'public-artifact',
          passwordProtected: content.passwordProtected,
        })
      );
    } catch (error) {
      return frameTerminal(frameContext, ctx.config, error);
    }
  });

  app.on(['GET', 'HEAD'], '/a/:share_id', async (context) => {
    if (!viewer) {
      return sharePageError(
        context as unknown as PublicContext,
        ctx.config,
        ctx.config.abuseEmail,
        null
      );
    }

    const shareId = context.req.param('share_id');
    if (!SHARE_ID_PATTERN.test(shareId)) {
      return sharePageError(
        context as unknown as PublicContext,
        ctx.config,
        ctx.config.abuseEmail,
        new ServiceError(404, 'not_found', 'Not found')
      );
    }

    try {
      const versionNum = parseVersionParam(new URL(context.req.url));
      const model = await viewer.getPageModel(shareId, versionNum);
      return context.html(
        ViewerPage({
          model,
          abuseEmail: ctx.config.abuseEmail,
          ...(versionNum ? { pinnedVersion: versionNum } : {}),
        }),
        200
      );
    } catch (error) {
      return sharePageError(
        context as unknown as PublicContext,
        ctx.config,
        ctx.config.abuseEmail,
        error
      );
    }
  });
}

function contentPayload(content: ViewerContentResult) {
  return {
    title: content.title,
    type: content.type,
    html: content.html,
    ...(content.frameUrl ? { frame_url: content.frameUrl } : {}),
    content_hash: content.contentHash,
    version_num: content.versionNum,
    latest_version_num: content.latestVersionNum,
    updated_at: new Date(content.updatedAt).toISOString(),
    bot: content.bot,
    password_protected: content.passwordProtected,
    footer: content.footer,
  };
}

function parseVersionParam(url: URL): number | undefined {
  const value = url.searchParams.get('v');
  if (value === null) {
    return undefined;
  }

  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new ServiceError(400, 'validation_failed', 'v must be an integer >= 1', { field: 'v' });
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ServiceError(400, 'validation_failed', 'v must be an integer >= 1', { field: 'v' });
  }

  return parsed;
}

async function handleJson(
  context: PublicContext,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    const serviceError = serviceErrorFromUnknown(error);
    return context.json(toErrorEnvelope(serviceError), serviceError.status);
  }
}

async function handleBinary(
  context: PublicContext,
  handler: () => Promise<Response>
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    const serviceError = serviceErrorFromUnknown(error);
    if (serviceError.status === 401) {
      return context.json(toErrorEnvelope(serviceError), 401);
    }
    return context.text(serviceError.message, serviceError.status);
  }
}

/**
 * The sandbox origin's terminal state. It cannot load the app stylesheet cross-origin and it must
 * stay under the same sandbox CSP as an artifact, so the response is a self-contained document
 * served with the artifact frame's own header set — never the bare `Not found` text that used to
 * render as two monospace words at the top-left of a white page.
 */
function frameTerminal(
  context: PublicContext,
  config: AppConfig,
  error: unknown
): Response | Promise<Response> {
  const serviceError = serviceErrorFromUnknown(error);
  const status = frameTerminalStatus(serviceError.status);

  return context.body(
    FrameTerminalDocument({ status, homeUrl: new URL('/', config.baseUrl).toString() }),
    status,
    // `passwordProtected: true` selects `Cache-Control: no-store`: a terminal answer must never be
    // cached in front of an artifact that may come back.
    publicArtifactFrameHeaders({ config, passwordProtected: true })
  );
}

function frameTerminalStatus(status: number): 401 | 404 | 410 {
  if (status === 401) {
    return 401;
  }
  if (status === 410) {
    return 410;
  }
  return 404;
}

function serviceErrorFromUnknown(error: unknown): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }

  return new ServiceError(500, 'internal_error', 'Internal server error');
}

function viewerCookie(context: PublicContext, viewer: ViewerService, config: AppConfig): string {
  const incoming = getCookie(context, 'aa_viewer');
  const viewerId = viewer.isValidViewerId(incoming) ? incoming : viewer.mintViewerId();
  setCookie(context, 'aa_viewer', viewerId, {
    path: '/',
    maxAge: VIEWER_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
  });
  return viewerId;
}

function shareToken(context: PublicContext): string | null {
  return context.req.header('x-aa-share-token') ?? getCookie(context, 'aa_sa') ?? null;
}

async function parseJsonBody(context: PublicContext): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await context.req.json()) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function quoteEtag(value: string): string {
  return `"${value}"`;
}

function etagMatches(header: string | undefined, expected: string): boolean {
  if (!header) {
    return false;
  }

  return header
    .split(',')
    .map((value) => value.trim())
    .includes(expected);
}

function sharePageError(
  context: PublicContext,
  config: AppConfig,
  abuseEmail: string,
  error: unknown
): Response | Promise<Response> {
  const serviceError = serviceErrorFromUnknown(error);
  const terminal = terminalCopy(serviceError);
  const current = safeShareUrl(context, config);
  return context.html(
    ShareTerminalPage({
      title: terminal.title,
      message: terminal.message,
      status: terminal.status,
      shareUrl: current,
      abuseEmail,
    }),
    terminal.status
  );
}

function terminalCopy(error: ServiceError): {
  title: string;
  message: string;
  status: 404 | 410 | 429;
} {
  if (error.status === 410 && error.code === 'share_expired') {
    return {
      title: 'This link has expired.',
      message: 'The owner set this share link to expire.',
      status: 410,
    };
  }

  if (error.status === 410) {
    if (error.message.toLowerCase().includes('artifact has expired')) {
      return {
        title: 'This artifact has expired.',
        message: 'The artifact is no longer available.',
        status: 410,
      };
    }

    return {
      title: 'This link has been revoked.',
      message: 'The owner turned off sharing for this artifact.',
      status: 410,
    };
  }

  if (error.status === 429) {
    return {
      title: 'Too many requests.',
      message: 'Please wait a moment and try again.',
      status: 429,
    };
  }

  return { title: 'Not found', message: 'Not found', status: 404 };
}

function safeShareUrl(context: PublicContext, config: AppConfig): string {
  const url = new URL(context.req.url);
  const shareId = url.pathname.split('/')[2];
  if (shareId && SHARE_ID_PATTERN.test(shareId)) {
    return new URL(`/a/${shareId}`, config.baseUrl).toString();
  }

  return new URL('/a/not-found', config.baseUrl).toString();
}

function frameRedirectUrl(context: PublicContext, config: AppConfig): string | null {
  if (!config.sandboxOrigin) {
    return null;
  }

  if (isSandboxHostRequest(config, context.req.url, context.req.header('host'))) {
    return null;
  }

  const url = new URL(context.req.url);
  const target = new URL(config.sandboxOrigin);
  target.pathname = url.pathname;
  target.search = url.search;
  return target.toString();
}

function rateLimited(context: PublicContext, retryAfterSeconds: number): Response {
  Object.entries(retryAfterResponseHeaders({ retryAfter: retryAfterSeconds })).forEach(
    ([name, value]) => {
      context.header(name, value);
    }
  );
  return context.json(
    toErrorEnvelope(new ServiceError(429, 'rate_limited', 'Too many requests')),
    429
  );
}
