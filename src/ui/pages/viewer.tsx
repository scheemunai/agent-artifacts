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

export function ViewerPage({ model, pinnedVersion }: ViewerPageProps) {
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
      <ViewerFooter showProductFooter={model.footer} />
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
 * stated once instead of twice, and the terminal card is the only thing the page's flex column has
 * to place. Rendering them here rather than building markup in the script is what makes the server
 * and client one implementation.
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
          <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
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
            required
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

  const hasBot = Boolean(content?.bot);

  return (
    // A compact, dark status bar — it reads as the chrome around a published artifact, not as part
    // of the document. Title + a live dot on the left; details and actions on the right.
    //
    // ONE DOM, TWO ARRANGEMENTS. The meta and the actions live inside `.aa-viewer-menu` at every
    // size. On desktop that wrapper is `display: contents`, so its children lay out inline in the
    // bar exactly as before. On a phone it becomes a panel behind the ⋮ toggle. Rendering the
    // controls twice was the alternative and is not one: it would duplicate `id="aa-version-picker"`
    // and leave `viewer.js` updating whichever copy it happened to query first.
    <header class="aa-viewer-chrome" data-aa-chrome="true">
      <div class="aa-viewer-chrome__lead">
        <span class="aa-viewer-chrome__dot" aria-hidden="true"></span>
        <span class="aa-viewer-title" data-aa-title="true">
          {content?.title ?? 'Loading…'}
        </span>
        <span
          class="aa-badge aa-badge--accent aa-viewer-updated-pill"
          data-aa-updated-pill="true"
          hidden
        >
          Updated ✓
        </span>
      </div>

      <div class="aa-viewer-chrome__end">
        {/* `data-aa-open`, not `hidden`: the attribute would keep this out of the accessibility
            tree on desktop, where the panel is not a panel at all but the inline bar contents. */}
        <div
          class="aa-viewer-menu"
          id="aa-viewer-menu"
          data-aa-menu-panel="true"
          data-aa-open="false"
        >
          <span class="aa-viewer-chrome__meta">
            <span class="aa-viewer-byline" data-aa-byline="true" hidden={hasBot ? undefined : true}>
              {content?.bot ? formatByline(content.bot) : ''}
            </span>
            <span
              class="aa-viewer-chrome__sep"
              aria-hidden="true"
              hidden={hasBot ? undefined : true}
            >
              ·
            </span>
            <span class="aa-viewer-updated" data-aa-updated-at="true">
              {content ? `updated ${formatRelativeTime(content.updatedAt)}` : ''}
            </span>
          </span>
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
                <option
                  value={String(version)}
                  selected={(pinnedVersion ?? latestVersion) === version}
                >
                  v{version}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              class="aa-viewer-download"
              href={downloadHref}
              dataAttrs={{ 'data-aa-download': 'true' }}
            >
              <DownloadIcon />
              <span class="aa-viewer-download__label">Download</span>
            </Button>
          </div>
        </div>
        {/* Phones only. A real button with `aria-expanded` and `aria-controls`, driven by
            `viewer.js` — NOT a `<details>`: a closed disclosure hides its content from the
            accessibility tree and from `querySelector`-driven updates, and browsers refuse to lay
            out `::details-content` at all when closed, which is how the earlier attempt broke. */}
        <button
          type="button"
          class="aa-btn aa-btn--secondary aa-btn--icon aa-viewer-menu-toggle"
          aria-expanded="false"
          aria-controls="aa-viewer-menu"
          aria-label="Artifact details and actions"
          title="Artifact details and actions"
          data-aa-menu-toggle="true"
        >
          <KebabIcon />
        </button>
        <Button
          variant="secondary"
          class="aa-viewer-refresh"
          iconOnly
          ariaLabel="Refresh artifact"
          title="Refresh artifact"
          dataAttrs={{ 'data-aa-refresh': 'true' }}
        >
          <RefreshIcon />
        </Button>
      </div>
    </header>
  );
}

/**
 * The chrome's three marks, in the product's one icon style: a 24-unit box, no fill, `currentColor`
 * at 1.75, round joins — the same specification `NoticeIcon` and the password reveal follow.
 *
 * They are SVG because they used to be text. `⭳` (U+2B33) and `↻` (U+21BB) are outside the
 * coverage of the default UI fonts on Android and older iOS, so the two controls a reader is most
 * likely to want rendered as tofu boxes on exactly the devices most likely to open a shared link.
 * A glyph is a font dependency; a path is not.
 */
function ViewerIcon({ children }: { children: Child }) {
  return (
    <svg
      class="aa-viewer-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
      role="presentation"
    >
      {children}
    </svg>
  );
}

function DownloadIcon() {
  return (
    <ViewerIcon>
      <path d="M12 3.75v10.5" />
      <path d="m7.75 10.5 4.25 4.25 4.25-4.25" />
      <path d="M4.75 15.75v2.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2v-2.5" />
    </ViewerIcon>
  );
}

function RefreshIcon() {
  return (
    <ViewerIcon>
      {/* The arc runs three quarters of the way round and then curves OUT to meet a corner sitting
          clear of the circle. An earlier attempt put the corner's arms on the ring itself, where
          the horizontal arm merged into the arc and what was left read as a power symbol — the one
          mark on a shared page that must not be mistaken for a switch. */}
      <path d="M19.5 12a7.5 7.5 0 1 1-7.5-7.5c2.1 0 4.1.83 5.6 2.28L19.5 8.7" />
      <path d="M19.5 4.5v4.2h-4.2" />
    </ViewerIcon>
  );
}

function KebabIcon() {
  return (
    <ViewerIcon>
      <path d="M12 5.5h.01" />
      <path d="M12 12h.01" />
      <path d="M12 18.5h.01" />
    </ViewerIcon>
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

/**
 * The product's own line on a shared artifact — and nothing else.
 *
 * NO ELEMENT AT ALL when branding is removed. This used to return the `<footer>` shell regardless
 * and only drop its contents, so a paid artifact ended on an empty white bar: a strip of chrome
 * asserting nothing, on the one plan whose whole promise is "no footer but yours". An empty
 * container is not a smaller footer, it is a defect that looks like padding.
 */
export function ViewerFooter({ showProductFooter }: { showProductFooter: boolean }) {
  if (!showProductFooter) {
    return null;
  }

  return (
    <footer class="aa-viewer-footer">
      <a class="aa-viewer-footer__brand" href="https://agentartifact.ai" rel="noopener noreferrer">
        Made with <ProductMark /> Agent Artifacts
      </a>
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

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}
