import type { Child } from 'hono/jsx';
import type { ViewerContentResult, ViewerPageModel } from '../../services/viewer.js';
import { stylesheetHref } from '../assets.js';
import { UI_FOUNDATION_SCRIPT_SRC } from '../components/layout.js';
import { Button, ProductMark } from '../components/primitives.js';

export const VIEWER_SCRIPT_SRC = '/assets/viewer-0f4f9f6c8a7e.js';
export const VIEWER_STYLESHEET_HREF = '/assets/viewer-4fd0df5f2b2a.css';

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
          <div
            class="aa-viewer-version-banner"
            data-aa-version-banner="true"
            hidden={pinnedVersion ? undefined : true}
          >
            <span data-aa-version-banner-text="true">
              {pinnedVersion && model.initialContent
                ? `Viewing v${pinnedVersion} of v${model.initialContent.latestVersionNum}`
                : ''}
            </span>
            <a href={model.canonicalUrl} data-aa-view-latest="true">
              View latest
            </a>
          </div>
          <section class="aa-viewer-content" data-aa-content="true" aria-live="polite">
            {model.initialContent ? <InitialContent content={model.initialContent} /> : null}
          </section>
        </section>
      </main>
      <ViewerFooter
        showProductFooter={model.footer}
        abuseHref={abuseHref(abuseEmail, model.canonicalUrl)}
      />
    </ViewerDocument>
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
  const ogImage = imageUrl ?? new URL('/assets/og-fallback.png', canonicalUrl).toString();

  return (
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
        <link rel="stylesheet" href={VIEWER_STYLESHEET_HREF} />
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
        <script type="module" src={UI_FOUNDATION_SCRIPT_SRC}></script>
        {includeViewerScript ? <script type="module" src={VIEWER_SCRIPT_SRC}></script> : null}
      </body>
    </html>
  );
}

function PasswordGate({ visible }: { visible: boolean }) {
  return (
    <section
      class="aa-viewer-gate"
      data-aa-password-gate="true"
      hidden={visible ? undefined : true}
    >
      <div class="aa-viewer-gate-card">
        <ProductMark />
        <h1>This artifact is password-protected.</h1>
        <p>Enter the password to view this artifact.</p>
        <form class="aa-viewer-password-form" data-aa-password-form="true">
          <label class="aa-label" for="aa-share-password">
            Password
          </label>
          <input
            class="aa-control"
            id="aa-share-password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          />
          <p class="aa-error" id="aa-password-error" data-aa-password-error="true" hidden></p>
          <Button variant="primary" type="submit" dataAttrs={{ 'data-aa-password-submit': 'true' }}>
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
          <h1 data-aa-title="true">{content?.title ?? 'Loading…'}</h1>
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
        <Button
          variant="ghost"
          ariaLabel="Refresh artifact"
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
        sandbox="allow-scripts"
        src={content.frameUrl}
        title={content.title}
      ></iframe>
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: content.html ?? '' }} />;
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
        <a href="https://agentartifact.ai" rel="noopener noreferrer">
          Made with ◆ Agent Artifacts
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
