import type { Env, Hono } from 'hono';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type { CloudModule } from '../extension/cloud-module.js';
import { createDefaultCloudModule } from '../extension/default-module.js';
import { ownerPreviewFrameHeaders, publicArtifactFrameHeaders } from '../lib/frame-policy.js';
import { sandboxRedirectUrl } from '../lib/host-guard.js';
import { type OwnerPreviewClaims, verifyOwnerPreviewToken } from '../lib/preview-token.js';
import type { Logger } from '../logger.js';
import { ArtifactService } from '../services/artifacts.js';
import { DashboardReadModelService } from '../services/dashboard-read-models.js';
import { FrameTerminalDocument } from '../ui/pages/frame-document.js';

export interface OwnerPreviewRoutesContext {
  config: AppConfig;
  logger: Logger;
  db?: DatabaseHandle;
  cloudModule?: CloudModule;
}

/**
 * `GET /preview/:token/frame` — the owner's own HTML, rendered on the isolated host.
 *
 * This is the sandbox-side half of the owner preview. It is a sibling of `/a/:share_id/frame` in
 * every respect that matters: it answers on the sandbox host, it is listed in the sandbox host
 * guard, it carries a frame CSP that sandboxes the document, and it never reads a cookie. The one
 * difference is what authorises it — a share id for the public frame, a five-minute signed token
 * for this one, because unpublished content has no share id and the sandbox host, being
 * cross-origin, never receives the dashboard session.
 *
 * ── NO COOKIE IS READ HERE, AND THAT IS THE POINT ──────────────────────────────────────────────
 *
 * A route that fell back to the session when the token failed would quietly re-create the bug on
 * self-hosted (where the two hosts coincide and the cookie *is* present) while leaving cloud
 * broken, and the two deployments would stop testing each other. The token is the only credential
 * this route accepts, in both deployments.
 */
export function registerOwnerPreviewRoutes<E extends Env>(
  app: Hono<E>,
  ctx: OwnerPreviewRoutesContext
): void {
  const cloudModule = ctx.cloudModule ?? createDefaultCloudModule(ctx.config);
  const services = ctx.db
    ? {
        artifacts: new ArtifactService({
          db: ctx.db,
          extension: cloudModule,
          baseUrl: ctx.config.baseUrl,
          logger: ctx.logger,
        }),
        reads: new DashboardReadModelService(ctx.db, { baseUrl: ctx.config.baseUrl }),
      }
    : null;

  app.on(['GET', 'HEAD'], '/preview/:token/frame', async (context) => {
    // A preview URL that reached the app host on a cloud instance is a URL the CSP would refuse to
    // frame anyway. Same 301 the public artifact frame issues, from the same helper.
    const redirectUrl = sandboxRedirectUrl(ctx.config, context.req.url, context.req.header('host'));
    if (redirectUrl) {
      return context.redirect(redirectUrl, 301);
    }

    const claims = verifyOwnerPreviewToken(
      ctx.config.sessionSecret,
      context.req.param('token'),
      Date.now()
    );
    if (!claims || !services) {
      return previewTerminal(ctx.config);
    }

    const content = await readPreviewContent(services, claims);
    if (content === null) {
      return previewTerminal(ctx.config);
    }

    // Served exactly as stored, with no document shell — the same bytes the route this replaced
    // returned. An owner preview that wrapped the fragment would render it differently from the
    // artifact detail page it was promoted from, which is the trade the template frame already
    // rejected once.
    return context.body(content, 200, ownerPreviewFrameHeaders(ctx.config));
  });
}

interface PreviewServices {
  artifacts: ArtifactService;
  reads: DashboardReadModelService;
}

/**
 * Reads the subject the token names, scoped to the account the token names.
 *
 * Every query is account-scoped, so a valid token for account A can never surface account B's work
 * even if the ids were guessed: the token supplies the account, and the account is a predicate in
 * the SQL, not a check performed afterwards.
 *
 * `retentionDays: null` matches the detail page that minted the token — an owner looking at their
 * own artifact sees it whether or not the public share window has closed.
 *
 * `claims.contentHash` is signed but not compared here, and the omission is deliberate. The token
 * lives five minutes; if an agent republishes the artifact inside that window, the honest thing to
 * show the owner is the content that exists now, not a terminal page announcing that the preview
 * token is stale. Binding the hash still buys what it is for — the URL changes whenever the content
 * does, so no cache can serve a previous revision — without turning a routine update into a broken
 * card. The token authorises *this owner's copy of this artifact*, at whatever revision that is.
 */
async function readPreviewContent(
  services: PreviewServices,
  claims: OwnerPreviewClaims
): Promise<string | null> {
  if (claims.subject === 'artifact') {
    const artifact = await services.reads.getDashboardArtifactDetail({
      accountId: claims.accountId,
      artifactId: claims.subjectId,
      retentionDays: null,
    });
    return artifact?.type === 'html' ? artifact.content : null;
  }

  const template = await services.artifacts.getTemplatePreview(claims.accountId, claims.subjectId);
  return template?.type === 'html' ? template.content : null;
}

/**
 * One answer for every failure — expired token, forged token, wrong account, deleted artifact,
 * markdown. The frame is on the sandbox origin and cannot load the app stylesheet, so it reuses the
 * public frame's self-contained terminal document rather than emitting two words of monospace.
 *
 * The status is always 404 and the copy never names a cause: this response is reachable by anyone
 * holding any string, so distinguishing "expired" from "not yours" would be an oracle. The owner's
 * own recourse is to reload the page they are already looking at, which mints a fresh token.
 */
function previewTerminal(config: AppConfig): Response {
  return new Response(
    FrameTerminalDocument({ status: 404, homeUrl: new URL('/', config.baseUrl).toString() }),
    {
      status: 404,
      // `passwordProtected: true` selects `Cache-Control: no-store`, which a terminal answer for a
      // token that may be seconds from being replaced by a working one must have.
      headers: publicArtifactFrameHeaders({ config, passwordProtected: true }),
    }
  );
}
