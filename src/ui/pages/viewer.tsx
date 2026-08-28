import type { Child } from 'hono/jsx';
import type { ViewerContentResult, ViewerPageModel } from '../../services/viewer.js';
import { assetHref, stylesheetHref } from '../assets.js';
import { DOCTYPE } from '../components/layout.js';
import { Button, Notice, PasswordInput, ProductMark } from '../components/primitives.js';
import {
  CLIENT_TERMINAL_COPY,
  type ClientTerminalStatus,
  ShareTerminalMain,
} from '../components/share-terminal-main.js';
import { VersionBanner } from '../components/version-banner.js';
import { TERMINAL_CAUSE_COPY, type TerminalCause } from '../copy/terminal-copy.js';

interface ViewerPageProps {
  model: ViewerPageModel;
  abuseEmail: string;
  pinnedVersion?: number | undefined;
}

interface ViewerDocumentProps {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl?: string;
  children: Child;
  bootJson?: string;
  includeViewerScript?: boolean;
}

interface BootContentPayload {
  title: string;
  type: 'markdown' | 'html';
  html: string | null;
  frame_url?: string;
  content_hash: string;
  version_num: number;
  latest_version_num: number;
  updated_at: string;
  bot: { name: string; byline: string | null } | null;
  password_protected: boolean;
  footer: boolean;
}

export function ViewerPage({ model, abuseEmail, pinnedVersion }: ViewerPageProps) {
  const boot = {
    shareId: model.shareId,
    contentUrl: `/a/${model.shareId}/content`,
    verifyUrl: `/a/${model.shareId}/verify-password`,
    downloadUrl: `/a/${model.shareId}/download`,
    canonicalUrl: model.canonicalUrl,
    pinnedVersion: pinnedVersion ?? null,
    passwordProtected: model.passwordProtected,
    initialContent: model.initialContent ? toBootContent(model.initialContent) : null,
  };

  return (
    <ViewerDocument
      title={`${model.meta.title} · Agent Artifacts`}
      description={model.meta.description}
      canonicalUrl={model.canonicalUrl}
      imageUrl={model.meta.imageUrl}
      bootJson={safeJson(boot)}
      includeViewerScript
    >
      <main class="aa-viewer" data-aa-viewer-root="true">
        <PasswordGate visible={model.passwordProtected} />
        <section
          class="aa-viewer-document"
          data-aa-document="true"
          hidden={model.passwordProtected ? true : undefined}
        >
          <ViewerChrome content={model.initialContent} pinnedVersion={pinnedVersion} />
          <RefreshStatus />
          <VersionBanner
            shownVersion={pinnedVersion ?? null}
            latestVersion={
              model.initialContent?.latestVersionNum ?? model.initialContent?.versionNum ?? 1
            }
            canonicalUrl={model.canonicalUrl}
          />
          <section class="aa-viewer-content" data-aa-content="true" aria-live="polite">
            {model.initialContent ? <InitialContent content={model.initialContent} /> : null}
          </section>
        </section>
      </main>
      <ViewerFooter
        showProductFooter={model.footer}
        abuseHref={abuseHref(abuseEmail, model.canonicalUrl)}
      />
      <ClientTerminalTemplates shareUrl={model.canonicalUrl} />
    </ViewerDocument>
  );
}

/**
 * What the viewer says when a refresh fails.
 *
 * Before this, nothing was said at all: the script only handled `!response.ok`, and a real network
 * failure makes `fetch` *throw*, which never reached that branch. A pixel diff of the offline
 * render against the idle one differed only in a button's hover fill — the page silently went on
 * presenting stale content as live.
 *
 * Both states are rendered here rather than built in the script, for the same reason the terminal
 * templates are: one implementation, no copy in the client. They sit directly under the chrome
 * that holds the refresh control, which is the attached rung — a status belongs beside the thing
 * it describes, not floating at the top of the page or in a toast region the viewer never had.
 */
function RefreshStatus() {
  return (
    <div class="aa-viewer-status" data-aa-viewer-status-region="true">
      <div data-aa-viewer-status="offline" hidden>
        <Notice tone="warn" title="You appear to be offline.">
          This page is showing the last version it loaded, and will catch up on its own once the
          connection is back.
        </Notice>
      </div>
      <div data-aa-viewer-status="stale" hidden>
        <Notice tone="danger" title="Could not refresh this artifact.">
          This page is showing the last version it loaded. Try again in a moment.
        </Notice>
      </div>
    </div>
  );
}

/**
 * The terminal states a mid-view poll can discover, rendered by the server and parked inert until
 * the client needs one.
 *
 * A screen's header is part of its state, not a constant. When the poll finds the share gone, the
 * client replaces the whole viewer root with one of these — so the chrome that was asserting the
 * previous state (the title, the version picker, Download, refresh) leaves with it, the failure is
 * stated once instead of twice, and `.aa-viewer-terminal`'s full-page min-height has nothing above
 * it, which is what keeps the footer's "Report abuse" on screen. Rendering them here rather than
 * building markup in the script is what makes the server and client one implementation.
 */
function ClientTerminalTemplates({ shareUrl }: { shareUrl: string }) {
  return (
    <>
      {(Object.keys(CLIENT_TERMINAL_COPY) as unknown as ClientTerminalStatus[]).map((status) => (
        <template data-aa-terminal-template={String(status)}>
          <ShareTerminalMain
            title={CLIENT_TERMINAL_COPY[status].title}
            message={CLIENT_TERMINAL_COPY[status].message}
            shareUrl={shareUrl}
            status={status}
            headingId={`terminal-title-${status}`}
          />
        </template>
      ))}
      {/*
        One template per cause the 410 envelope can name. The status templates above stay as the
        fallback for a body that cannot be parsed or a code nobody has seen before — the client
        must still have something to show when the server says something new.
      */}
      {(Object.keys(TERMINAL_CAUSE_COPY) as TerminalCause[]).map((cause) => (
        <template data-aa-terminal-template={cause}>
          <ShareTerminalMain
            title={TERMINAL_CAUSE_COPY[cause].title}
            message={TERMINAL_CAUSE_COPY[cause].message}
            shareUrl={shareUrl}
            status={410}
            headingId={`terminal-title-${cause}`}
          />
        </template>
      ))}
    </>
  );
}

export function ViewerDocument({
  title,
  description,
  canonicalUrl,
  imageUrl,
  children,
  bootJson,
  includeViewerScript = false,
}: ViewerDocumentProps) {
  const pageTitle = title;
  // Resolved from the manifest, never named literally: a hash in page source is a promise the page
  // cannot keep. Anything the build has not produced is omitted rather than emitted as a 404.
  const viewerStylesheet = assetHref('viewer.css');
  const foundationScript = assetHref('ui-foundation.js');
  const viewerScript = assetHref('viewer.js');
  const ogImage = imageUrl ?? new URL('/assets/og-fallback.png', canonicalUrl).toString();

  return (
    <>
      {DOCTYPE}
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="description" content={description} />
          <meta property="og:title" content={title.replace(/ · Agent Artifacts$/, '')} />
          <meta property="og:description" content={description} />
          <meta property="og:type" content="article" />
          <meta property="og:site_name" content="Agent Artifacts" />
          <meta property="og:url" content={canonicalUrl} />
          <meta property="og:image" content={ogImage} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={title.replace(/ · Agent Artifacts$/, '')} />
          <meta name="twitter:description" content={description} />
          <link rel="canonical" href={canonicalUrl} />
          <link rel="stylesheet" href={stylesheetHref()} />
          {viewerStylesheet ? <link rel="stylesheet" href={viewerStylesheet} /> : null}
          <title>{pageTitle}</title>
        </head>
        <body class="aa-page aa-public-page">
          {children}
          {bootJson ? (
            <script
              id="aa-boot"
              type="application/json"
              dangerouslySetInnerHTML={{ __html: bootJson }}
            />
          ) : null}
          {foundationScript ? <script type="module" src={foundationScript}></script> : null}
          {includeViewerScript && viewerScript ? (
            <script type="module" src={viewerScript}></script>
          ) : null}
        </body>
      </html>
    </>
  );
}

export function PasswordGate({ visible }: { visible: boolean }) {
  return (
    <section
      class="aa-viewer-gate"
      data-aa-password-gate="true"
      hidden={visible ? undefined : true}
    >
      <div class="aa-viewer-gate-card">
        <ProductMark />
        {visible ? (
          <h1>This artifact is password-protected.</h1>
        ) : (
          <h2>This artifact is password-protected.</h2>
        )}
        <p>Enter the password to view this artifact.</p>
        <form class="aa-viewer-password-form" data-aa-password-form="true">
          {/* The registered field, not a local one: the reveal toggle and the Caps Lock warning are
              the two things this gate was missing, and both belong to every password field in the
              product rather than to this page.
              `autofocus` is conditional because the gate element renders on every viewer page and
              is hidden when the artifact needs no password — the primitive's rule is the FIRST
              actionable field of a page whose only job is that form, and a hidden field is not
              that. */}
          <PasswordInput
            id="aa-share-password"
            name="password"
            label="Password"
            autocomplete="current-password"
            autofocus={visible}
          />
          {/* Always in flow with a reserved line height: revealing the message must not move the
              submit button. Empty content keeps it silent for assistive tech until it has copy. */}
          <p
            class="aa-error aa-viewer-password-error"
            id="aa-password-error"
            data-aa-password-error="true"
            role="alert"
          ></p>
          <Button
            variant="primary"
            type="submit"
            fullWidth
            dataAttrs={{ 'data-aa-password-submit': 'true' }}
          >
            View artifact
          </Button>
        </form>
      </div>
    </section>
  );
}

function ViewerChrome({
  content,
  pinnedVersion,
}: {
  content: ViewerContentResult | null;
  pinnedVersion?: number | undefined;
}) {
  const downloadHref = content
    ? `/a/${content.shareId}/download${pinnedVersion ? `?v=${pinnedVersion}` : ''}`
    : '#';
  const latestVersion = content?.latestVersionNum ?? content?.versionNum ?? 1;

  return (
    <header class="aa-viewer-chrome" data-aa-chrome="true">
      <div class="aa-viewer-heading">
        <div class="aa-viewer-title-row">
          <p class="aa-viewer-title" data-aa-title="true">
            {content?.title ?? 'Loading…'}
          </p>
          <span
            class="aa-badge aa-badge--accent aa-viewer-updated-pill"
            data-aa-updated-pill="true"
            hidden
          >
            Updated ✓
          </span>
        </div>
        <p class="aa-viewer-byline" data-aa-byline="true" hidden={content?.bot ? undefined : true}>
          {content?.bot ? formatByline(content.bot) : ''}
        </p>
        <p class="aa-viewer-updated" data-aa-updated-at="true">
          {content ? `updated ${formatRelativeTime(content.updatedAt)}` : ''}
        </p>
      </div>
      <div class="aa-viewer-actions">
        <label class="sr-only" for="aa-version-picker">
          Artifact version
        </label>
        <select
          class="aa-control aa-viewer-version-select"
          id="aa-version-picker"
          data-aa-version-picker="true"
          hidden={latestVersion > 1 ? undefined : true}
        >
          {Array.from({ length: latestVersion }, (_, index) => index + 1).map((version) => (
            <option value={String(version)} selected={(pinnedVersion ?? latestVersion) === version}>
              v{version}
            </option>
          ))}
        </select>
        <Button variant="secondary" href={downloadHref} dataAttrs={{ 'data-aa-download': 'true' }}>
          ⭳ Download
        </Button>
        {/* Bordered and square, matching Download beside it. The control was never unlabelled —
            it has had both an accessible name and a tooltip — but a bare 14px muted glyph with no
            box next to a bordered button does not read as a control at all. */}
        <Button
          variant="secondary"
          iconOnly
          ariaLabel="Refresh artifact"
          title="Refresh artifact"
          dataAttrs={{ 'data-aa-refresh': 'true' }}
        >
          ↻
        </Button>
      </div>
    </header>
  );
}

function InitialContent({ content }: { content: ViewerContentResult }) {
  if (content.type === 'html' && content.frameUrl) {
    return (
      <iframe
        class="aa-viewer-frame"
        data-aa-frame="true"
        data-aa-frame-height="default"
        sandbox="allow-scripts"
        src={content.frameUrl}
        title={content.title}
      ></iframe>
    );
  }

  // `aa-prose-page` supplies the reading column. It lives on the wrapper rather than on `.aa-md`
  // itself so the identical rendered markdown can also sit inside a dashboard card without
  // dragging a 64px top margin and a second inset in with it. `viewer-*.js` builds the same
  // wrapper, so the server DOM and the polled DOM are one shape.
  return <div class="aa-prose-page" dangerouslySetInnerHTML={{ __html: content.html ?? '' }} />;
}

export function ViewerFooter({
  showProductFooter,
  abuseHref,
}: {
  showProductFooter: boolean;
  abuseHref: string;
}) {
  return (
    <footer class="aa-viewer-footer">
      {showProductFooter ? (
        <a
          class="aa-viewer-footer__brand"
          href="https://agentartifact.ai"
          rel="noopener noreferrer"
        >
          Made with <ProductMark /> Agent Artifacts
        </a>
      ) : null}
      {showProductFooter ? <span aria-hidden="true">·</span> : null}
      <a href={abuseHref}>Report abuse</a>
    </footer>
  );
}

function toBootContent(content: ViewerContentResult): BootContentPayload {
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

function formatByline(bot: { name: string; byline: string | null }): string {
  return bot.byline ? `by ${bot.name} · ${bot.byline}` : `by ${bot.name}`;
}

function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 60) {
    return 'just now';
  }

  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 48) {
    return `${deltaHours}h ago`;
  }

  return new Date(timestamp).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function abuseHref(email: string, shareUrl: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(`Report abuse: ${shareUrl}`)}`;
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
