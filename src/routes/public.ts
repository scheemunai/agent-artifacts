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
import { sandboxRedirectUrl } from '../lib/host-guard.js';
import { generateCachedOgImage } from '../lib/og.js';
import {
  clientIp,
  InMemoryRateLimitStore,
  rateLimitDecision,
  rateLimitKey,
  retryAfterResponseHeaders,
} from '../lib/rate-limit.js';
import type { Logger } from '../logger.js';
import { AnalyticsRecorder, readViewRequestFacts } from '../services/analytics.js';
import { ServiceError, toErrorEnvelope } from '../services/errors.js';
import { SessionService } from '../services/sessions.js';
import { SHARE_ID_PATTERN, type ViewerContentResult, ViewerService } from '../services/viewer.js';
import { TERMINAL_CAUSE_COPY } from '../ui/copy/terminal-copy.js';
import { FrameDocument, FrameTerminalDocument } from '../ui/pages/frame-document.js';
import {
  CLIENT_TERMINAL_COPY,
  ShareTerminalPage,
  type ShareTerminalStatus,
} from '../ui/pages/share-terminal.js';
import { ViewerPage } from '../ui/pages/viewer.js';

export interface PublicRoutesContext {
  config: AppConfig;
  logger: Logger;
  db?: DatabaseHandle;
  cloudModule?: CloudModule;
  /** Injected by tests so a flush can be awaited; created here in production. */
  analytics?: AnalyticsRecorder;
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
  const analytics =
    ctx.analytics ??
    (ctx.db
      ? new AnalyticsRecorder({
          db: ctx.db,
          baseUrl: ctx.config.baseUrl,
          logger: ctx.logger,
          onView: (view) =>
            cloudModule.onArtifactEvent?.({
              type: 'share.viewed',
              accountId: view.accountId,
              artifactId: view.artifactId,
              shareId: view.shareId,
              at: new Date(view.at).toISOString(),
            }),
        })
      : null);
  const rateLimitStore = new InMemoryRateLimitStore();
  // The dashboard's own session service, reused rather than reimplemented: "is this cookie a valid
  // session" is a security question with one right answer, and a second copy of it here would be a
  // second copy to keep correct.
  const sessions = ctx.db ? new SessionService(ctx.db, ctx.config) : null;

  /**
   * The signed-in account behind this request, or null.
   *
   * Best-effort by design. This runs on a public page that must render for anyone, so every way of
   * not being signed in — no cookie, a forged one, an expired session, a deleted account, or the
   * session store being unhappy — resolves to "a stranger", which is the safe answer. It never
   * decides whether the page is served, only whether the page's history is.
   */
  const requesterAccountId = async (context: Context): Promise<string | null> => {
    if (!sessions) {
      return null;
    }

    try {
      const session = await sessions.validateContext(context);
      return session?.account.id ?? null;
    } catch (error) {
      ctx.logger.warn({ err: error }, 'public.viewer.session_lookup_failed');
      return null;
    }
  };

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
        requesterAccountId: await requesterAccountId(context),
      });
      // Described by what was SERVED, not by what was asked for. A stranger sending `?v=1` now
      // receives the latest content, and marking that immutable for a day would park the current
      // artifact in their cache under a historical URL — and hand it back to the owner, who is
      // entitled to v1, from their own browser.
      const servedHistoricalVersion = content.versionNum !== content.latestVersionNum;
      const etag = quoteEtag(content.contentHash);
      context.header('ETag', etag);
      context.header(
        'Cache-Control',
        servedHistoricalVersion
          ? 'private, max-age=86400, immutable'
          : 'private, max-age=10, must-revalidate'
      );

      if (etagMatches(context.req.header('if-none-match'), etag)) {
        return context.body(null, 304);
      }

      /*
       * THIS ENDPOINT NO LONGER COUNTS ORDINARY READS, AND THAT IS THE POINT OF THE CHANGE.
       *
       * It used to be the only place a view was ever recorded, reached because `viewer.js` fetches
       * it on load. So a reader who blocks scripts read the whole artifact — the page ships the
       * content inline — and registered nothing, while every crawler that did fetch it registered a
       * fresh unique viewer. Counting now happens where the page is served, which needs no client
       * cooperation. Counting here as well would double every scripted reader.
       *
       * ONE EXCEPTION: a password-protected share renders a gate with no content, so its read has
       * not happened yet at page render. The read is this request — the first one that carries a
       * valid token and actually hands over the artifact.
       */
      const poll = url.searchParams.get('poll') === '1';
      if (
        analytics &&
        content.passwordProtected &&
        !poll &&
        context.req.method === 'GET' &&
        !servedHistoricalVersion
      ) {
        recordRead(context as unknown as PublicContext, analytics, ctx.config, content, 'unlock');
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

      const success = await viewer.verifyPassword(shareId, body.password, {
        requesterAccountId: await requesterAccountId(context),
      });
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

  /*
   * "THE READER RAN OUR SCRIPT." A QUALITY SIGNAL, AND ONLY THAT.
   *
   * It cannot create a view — there is no capture here — and it cannot remove one. All it does is
   * stamp `js_confirmed` on reads already recorded for this reader. The ratio it produces is our
   * instrument for the thing server-side counting gave up: a crawler that is not in the bot table
   * yet shows up as an artifact whose reads suddenly stop being confirmed by anything.
   *
   * POST because it changes state, and because a GET beacon would be replayed by every prefetcher.
   */
  app.post('/a/:share_id/pulse', async (context) => {
    const shareId = context.req.param('share_id');
    if (!analytics || !viewer || !SHARE_ID_PATTERN.test(shareId)) {
      return context.body(null, 204);
    }
    // Resolved, so a pulse cannot confirm reads on a share the caller could not open — and so a
    // revoked or expired link stops accepting them at the same moment it stops serving.
    try {
      await viewer.getPageModel(shareId, { requesterAccountId: await requesterAccountId(context) });
    } catch {
      return context.body(null, 204);
    }
    analytics.confirmJs({
      shareId,
      facts: readViewRequestFacts(context.req, clientIp(context, ctx.config.trustProxy)),
    });
    return context.body(null, 204);
  });

  app.on(['GET', 'HEAD'], '/a/:share_id/download', async (context) => {
    if (!viewer) {
      return context.json(toErrorEnvelope(new ServiceError(404, 'not_found', 'Not found')), 404);
    }

    return handleBinary(
      context as unknown as PublicContext,
      async () => {
        const versionNum = parseVersionParam(new URL(context.req.url));
        const content = await viewer.getDownload(context.req.param('share_id'), {
          ...(versionNum ? { versionNum } : {}),
          viewerToken: shareToken(context as unknown as PublicContext),
          requesterAccountId: await requesterAccountId(context),
        });
        // Named and cached for the version actually served: a stranger who asks for `?v=1` gets
        // the latest artifact, and the file that lands in their downloads folder must not claim to
        // be v1.
        const servedHistoricalVersion = content.versionNum !== content.latestVersionNum;
        const extension = content.type === 'markdown' ? 'md' : 'html';
        const filename = `${content.slug}${
          servedHistoricalVersion ? `-v${content.versionNum}` : ''
        }.${extension}`;
        return context.body(content.content, 200, {
          'Content-Type':
            content.type === 'markdown' ? 'text/markdown; charset=utf-8' : FRAME_CONTENT_TYPE,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': servedHistoricalVersion
            ? 'private, max-age=86400, immutable'
            : 'private, max-age=10',
        });
      },
      (serviceError) =>
        sharePageError(context as unknown as PublicContext, ctx.config, serviceError)
    );
  });

  app.on(['GET', 'HEAD'], '/a/:share_id/og.png', async (context) => {
    if (!viewer) {
      return context.text('Not found', 404);
    }

    // Set BEFORE the lookup so it lands on the refusal. A private artifact's card must never be
    // cached — least of all by a shared cache, which would keep answering for an hour after the
    // gate said no. The success path below returns its own Response and keeps `public, max-age`;
    // only the error path, built by `context.text`, inherits this.
    context.header('Cache-Control', 'no-store');

    return handleBinary(context as unknown as PublicContext, async () => {
      const og = await viewer.getOgModel(context.req.param('share_id'), {
        requesterAccountId: await requesterAccountId(context),
      });
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
    const redirectUrl = sandboxRedirectUrl(ctx.config, context.req.url, context.req.header('host'));
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
        // Both, because the frame is reached two ways: same-origin in a self-host, where the
        // owner's cookie arrives, and cross-origin on a sandbox host, where only the signed grant
        // in the URL can speak for them.
        requesterAccountId: await requesterAccountId(context),
        versionToken: url.searchParams.get('vt'),
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
      return sharePageError(context as unknown as PublicContext, ctx.config, null);
    }

    const shareId = context.req.param('share_id');
    if (!SHARE_ID_PATTERN.test(shareId)) {
      return sharePageError(
        context as unknown as PublicContext,
        ctx.config,
        new ServiceError(404, 'not_found', 'Not found')
      );
    }

    try {
      const versionNum = parseVersionParam(new URL(context.req.url));
      const model = await viewer.getPageModel(shareId, {
        ...(versionNum ? { versionNum } : {}),
        requesterAccountId: await requesterAccountId(context),
      });
      // The pin is echoed back only when the model honoured it. Passing the raw query value would
      // have the page announce "Viewing v1 of v3" over the latest content, and would put `v=1` in
      // the boot payload for the client to send on every poll.
      const pinnedVersion =
        model.initialContent &&
        model.initialContent.versionNum !== model.initialContent.latestVersionNum
          ? model.initialContent.versionNum
          : undefined;
      /*
       * THE READ, RECORDED WHERE IT ACTUALLY HAPPENS.
       *
       * `initialContent` is the artifact itself, rendered into this response. If it is present the
       * reader has been handed the document, whether or not their browser will run a single line of
       * our JavaScript — which is exactly the population the old counting site could not see. When
       * it is null this is a password gate, and nobody has read anything yet.
       *
       * Not awaited: `capture` classifies, hashes nothing, and appends to an in-memory buffer. The
       * database is touched by a timer, never by this request.
       */
      if (analytics && model.initialContent) {
        recordRead(
          context as unknown as PublicContext,
          analytics,
          ctx.config,
          model.initialContent,
          'page'
        );
      }

      return context.html(
        ViewerPage({
          model,
          ...(pinnedVersion ? { pinnedVersion } : {}),
        }),
        200
      );
    } catch (error) {
      return sharePageError(context as unknown as PublicContext, ctx.config, error);
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
  handler: () => Promise<Response>,
  htmlFallback?: (error: ServiceError) => Response | Promise<Response>
): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    const serviceError = serviceErrorFromUnknown(error);
    // The viewer's ⭳ Download is a link a human clicks. Once a share token has expired it answered
    // with the API's own envelope, so a reader following it landed on
    // `{"error":{"code":"password_required"…}}` in the browser's JSON viewer. Negotiated: a browser
    // gets the page, every other caller keeps the envelope byte for byte.
    if (htmlFallback && wantsHtml(context)) {
      return htmlFallback(serviceError);
    }
    if (serviceError.status === 401) {
      return context.json(toErrorEnvelope(serviceError), 401);
    }
    return context.text(serviceError.message, serviceError.status);
  }
}

function wantsHtml(context: PublicContext): boolean {
  return (context.req.header('accept') ?? '')
    .split(',')
    .some((part) => part.trim().toLowerCase().startsWith('text/html'));
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

/**
 * Record one read, and clean up after the mechanism this replaces.
 *
 * Uniqueness used to be a random UUID in `aa_viewer`, a first-party cookie with a 365-day life —
 * which is what made the privacy policy's "cookieless analytics" sentence untrue. Identity is now a
 * salted hash that no longer exists after 48 hours, so the cookie has no job. It is expired on
 * sight rather than merely abandoned: leaving a year-long identifier in the browsers of everyone
 * who ever opened a share would keep the claim false for a year.
 */
function recordRead(
  context: PublicContext,
  analytics: AnalyticsRecorder,
  config: AppConfig,
  content: ViewerContentResult,
  surface: 'page' | 'unlock'
): void {
  retireViewerCookie(context, config);
  analytics.capture({
    shareId: content.shareId,
    artifactId: content.artifactId,
    accountId: content.accountId,
    versionNum: content.versionNum,
    isOwner: content.isOwner,
    surface,
    facts: readViewRequestFacts(context.req, clientIp(context, config.trustProxy)),
  });
}

function retireViewerCookie(context: PublicContext, config: AppConfig): void {
  if (getCookie(context, 'aa_viewer') === undefined) {
    return;
  }
  setCookie(context, 'aa_viewer', '', {
    path: '/',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
  });
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
    }),
    terminal.status
  );
}

function terminalCopy(error: ServiceError): {
  title: string;
  message: string;
  status: ShareTerminalStatus;
} {
  if (error.status === 410 && error.code === 'share_expired') {
    return { ...TERMINAL_CAUSE_COPY.share_expired, status: 410 };
  }

  if (error.status === 410 && error.code === 'share_disabled') {
    // A suspended owner. The page must not claim the owner turned sharing off — that is simply
    // untrue — and must not disclose that the account was actioned either: the person holding the
    // link is not entitled to the owner's moderation state. So: what happened, not why.
    return { ...TERMINAL_CAUSE_COPY.share_disabled, status: 410 };
  }

  if (error.status === 410 && error.code === 'artifact_expired') {
    // Retention, not revocation. This branch used to be reached by lower-casing the error message
    // and looking for "artifact has expired" — a cause recovered from prose.
    return { ...TERMINAL_CAUSE_COPY.artifact_expired, status: 410 };
  }

  if (error.status === 410) {
    return { ...TERMINAL_CAUSE_COPY.share_revoked, status: 410 };
  }

  if (error.status === 429) {
    return {
      title: 'Too many requests.',
      message: 'Please wait a moment and try again.',
      status: 429,
    };
  }

  if (error.status === 401) {
    return {
      title: 'This artifact is password-protected.',
      message: 'Open the artifact and enter its password to download it.',
      status: 401,
    };
  }

  // The heading and the body used to carry the identical string, so the sentence under the title
  // added nothing. The one that does exists already: it is what the client renders when a poll
  // discovers a 404 mid-read, and the server saying something different about the same event is the
  // drift `terminal-copy.ts` exists to prevent.
  return { ...CLIENT_TERMINAL_COPY[404], status: 404 };
}

function safeShareUrl(context: PublicContext, config: AppConfig): string {
  const url = new URL(context.req.url);
  const shareId = url.pathname.split('/')[2];
  if (shareId && SHARE_ID_PATTERN.test(shareId)) {
    return new URL(`/a/${shareId}`, config.baseUrl).toString();
  }

  return new URL('/a/not-found', config.baseUrl).toString();
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
