import type { Child } from 'hono/jsx';
import { Layout } from '../components/layout.js';
import {
  Badge,
  Button,
  Card,
  CopyBlock,
  EmptyState,
  Input,
  NavShell,
  Select,
  Table,
  Textarea,
} from '../components/primitives.js';

export type DashboardSection = 'artifacts' | 'bots' | 'templates' | 'settings';
export type ArtifactType = 'markdown' | 'html';

export interface DashboardAccountView {
  id: string;
  email: string;
}

export interface DashboardBotView {
  id: string;
  name: string;
  byline: string | null;
  apiKeyLast4: string;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
}

export interface DashboardShareView {
  id: string;
  url: string;
  passwordProtected: boolean;
  viewCount: number;
  uniqueViewerCount: number;
  lastViewedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

export interface DashboardArtifactListItem {
  id: string;
  title: string;
  slug: string;
  type: ArtifactType;
  updatedAt: number;
  botName: string | null;
  botByline: string | null;
  activeShare: DashboardShareView | null;
  lifetimeViews: number;
  previousShareCount: number;
  expiresAt: number | null;
}

export interface DashboardArtifactDetail extends DashboardArtifactListItem {
  content: string;
  contentHash: string;
  versionNum: number;
  htmlPreview: string | null;
}

export interface DashboardArtifactVersion {
  versionNum: number;
  type: ArtifactType;
  title: string;
  content: string;
  contentHash: string;
  changeSummary: string | null;
  restoredFromVersion: number | null;
  createdByBotName: string | null;
  createdAt: number;
}

export interface DashboardTemplateView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  type: ArtifactType;
  slots: string[];
  builtIn: boolean;
}

export interface DashboardTemplatePreview extends DashboardTemplateView {
  content: string;
}

export interface DashboardNotice {
  tone: 'success' | 'warn' | 'danger' | 'info';
  message: string;
}

export interface DashboardNavItem {
  label: string;
  href: string;
}

export interface DashboardHomePageProps {
  account: DashboardAccountView;
  artifacts: DashboardArtifactListItem[];
  bots: DashboardBotView[];
  latestBot: DashboardBotView | null;
  baseUrl: string;
  extensionNavItems?: DashboardNavItem[] | undefined;
  filters: {
    q: string;
    botId: string;
    type: string;
    cursor: string;
    nextCursor: string | null;
  };
  notice?: DashboardNotice | undefined;
}

export function DashboardHomePage({
  account,
  artifacts,
  bots,
  latestBot,
  baseUrl,
  extensionNavItems,
  filters,
  notice,
}: DashboardHomePageProps) {
  return (
    <DashboardChrome
      title="Artifacts"
      account={account}
      active="artifacts"
      notice={notice}
      extensionNavItems={extensionNavItems}
    >
      <section class="aa-section">
        <header class="aa-section-header">
          <p class="aa-page-kicker">Artifacts</p>
          <h1 class="aa-section-title">Your agent's published work</h1>
          <p class="aa-section-note">
            Search title and slug, filter by bot or type, then open a row to preview, restore, or
            share it.
          </p>
        </header>
        <ArtifactFilters bots={bots} filters={filters} />
        {artifacts.length === 0 ? (
          <ArtifactEmptyState baseUrl={baseUrl} latestBot={latestBot} />
        ) : (
          <div class="aa-stack">
            {artifacts.map((artifact) => (
              <ArtifactRow artifact={artifact} />
            ))}
            <div class="aa-specimen-row">
              {filters.nextCursor ? (
                <Button
                  variant="secondary"
                  href={dashboardListHref({ ...filters, cursor: filters.nextCursor })}
                >
                  Load more
                </Button>
              ) : (
                <Badge tone="neutral">End of list</Badge>
              )}
            </div>
          </div>
        )}
      </section>
    </DashboardChrome>
  );
}

export interface DashboardArtifactPageProps {
  account: DashboardAccountView;
  artifact: DashboardArtifactDetail;
  versions: DashboardArtifactVersion[];
  diff: { left: DashboardArtifactVersion; right: DashboardArtifactVersion } | null;
  baseUrl: string;
  extensionNavItems?: DashboardNavItem[] | undefined;
  notice?: DashboardNotice | undefined;
  promoteError?: string | null | undefined;
}

export function DashboardArtifactPage({
  account,
  artifact,
  versions,
  diff,
  baseUrl,
  extensionNavItems,
  notice,
  promoteError,
}: DashboardArtifactPageProps) {
  return (
    <DashboardChrome
      title={artifact.title}
      account={account}
      active="artifacts"
      notice={notice}
      extensionNavItems={extensionNavItems}
    >
      <div class="aa-stack">
        <section class="aa-section">
          <header class="aa-section-header">
            <p class="aa-page-kicker">Artifact detail</p>
            <div class="aa-specimen-row">
              <h1 class="aa-section-title">{artifact.title}</h1>
              <ArtifactTypeBadge type={artifact.type} />
              {artifact.activeShare ? (
                <Badge tone="accent">◆ shared</Badge>
              ) : (
                <Badge>private</Badge>
              )}
            </div>
            <p class="aa-section-note">
              <code>{artifact.slug}</code> · {formatByline(artifact)} · updated{' '}
              {formatRelativeTime(artifact.updatedAt)}
            </p>
          </header>
          <div class="aa-specimen-row">
            <Button variant="secondary" href={`/dashboard/artifacts/${artifact.id}/download`}>
              Download
            </Button>
            <Button variant="primary" href="#share-panel">
              Share
            </Button>
            <form
              class="aa-stack"
              method="post"
              action={`/dashboard/api/artifacts/${artifact.id}/delete`}
            >
              <Input
                id="delete_artifact_confirm"
                name="confirm"
                label={`Type ${artifact.title} to delete`}
              />
              <Button variant="danger" type="submit">
                Delete
              </Button>
            </form>
          </div>
        </section>

        <div class="aa-grid aa-grid--2">
          <Card
            title="Rendered preview"
            description="Owner previews use the same sanitizing/sandboxing posture as public pages."
          >
            {artifact.type === 'markdown' && artifact.htmlPreview ? (
              <div dangerouslySetInnerHTML={{ __html: artifact.htmlPreview }} />
            ) : (
              <iframe
                title={artifact.title}
                sandbox="allow-scripts"
                src={`/dashboard/artifacts/${artifact.id}/frame`}
              ></iframe>
            )}
          </Card>
          <SharePanel artifact={artifact} />
        </div>

        <VersionHistory artifact={artifact} versions={versions} />
        {diff ? <VersionDiff diff={diff} /> : null}
        <PromotePanel artifact={artifact} baseUrl={baseUrl} error={promoteError ?? null} />
      </div>
    </DashboardChrome>
  );
}

export interface DashboardBotsPageProps {
  account: DashboardAccountView;
  bots: DashboardBotView[];
  baseUrl: string;
  extensionNavItems?: DashboardNavItem[] | undefined;
  shownKey?: { apiKey: string; botName: string } | undefined;
  notice?: DashboardNotice | undefined;
  error?: string | undefined;
}

export function DashboardBotsPage({
  account,
  bots,
  baseUrl,
  extensionNavItems,
  shownKey,
  notice,
  error,
}: DashboardBotsPageProps) {
  return (
    <DashboardChrome
      title="Bots"
      account={account}
      active="bots"
      notice={notice}
      extensionNavItems={extensionNavItems}
    >
      <div class="aa-stack">
        <section class="aa-section">
          <header class="aa-section-header">
            <p class="aa-page-kicker">Bot registry</p>
            <h1 class="aa-section-title">Bots are your agents' identities.</h1>
            <p class="aa-section-note">
              Each bot has a scoped API key, a byline, and immediate regenerate/revoke controls.
            </p>
          </header>
          <Card title="New bot" description="The key appears once after creation.">
            <form class="aa-stack" method="post" action="/dashboard/api/bots">
              {error ? <p class="aa-error">{error}</p> : null}
              <Input id="name" name="name" label="Bot name" placeholder="R2" />
              <Input
                id="byline"
                name="byline"
                label="Byline"
                placeholder="Andrej's Chief of Staff"
                optional
              />
              <Button variant="primary" type="submit">
                New bot
              </Button>
            </form>
          </Card>
        </section>

        {shownKey ? (
          <BotKeyCard baseUrl={baseUrl} apiKey={shownKey.apiKey} botName={shownKey.botName} />
        ) : null}

        {bots.length === 0 ? (
          <EmptyState
            title="No bots yet."
            description="A bot is your agent's identity and API key. Create one, copy the key once, and paste the install prompt into your agent."
          />
        ) : (
          <Table
            caption="Registered bots"
            columns={['Bot', 'Key', 'Last used', 'Actions']}
            rows={bots.map((bot) => [
              <span>
                <strong>{bot.name}</strong>
                <br />
                <span class="aa-hint">{bot.byline ?? 'No byline'}</span>
                {bot.revokedAt ? <Badge tone="danger">revoked</Badge> : null}
              </span>,
              <code>aa_bot_…{bot.apiKeyLast4}</code>,
              <span>{bot.lastUsedAt ? formatRelativeTime(bot.lastUsedAt) : 'never'}</span>,
              <BotActionForms bot={bot} />,
            ])}
          />
        )}
      </div>
    </DashboardChrome>
  );
}

export interface DashboardTemplatesPageProps {
  account: DashboardAccountView;
  templates: DashboardTemplateView[];
  previewTemplate?: DashboardTemplatePreview | null | undefined;
  extensionNavItems?: DashboardNavItem[] | undefined;
  notice?: DashboardNotice | undefined;
}

export function DashboardTemplatesPage({
  account,
  templates,
  previewTemplate,
  extensionNavItems,
  notice,
}: DashboardTemplatesPageProps) {
  const starters = templates.filter((template) => template.builtIn);
  const personal = templates.filter((template) => !template.builtIn);

  return (
    <DashboardChrome
      title="Templates"
      account={account}
      active="templates"
      notice={notice}
      extensionNavItems={extensionNavItems}
    >
      <div class="aa-stack">
        <section class="aa-section">
          <header class="aa-section-header">
            <p class="aa-page-kicker">Templates</p>
            <h1 class="aa-section-title">Reusable starts for agent output.</h1>
            <p class="aa-section-note">
              Built-ins are seeded by the app. Promote a markdown artifact with {'{{slots}}'} from
              its detail page to add your own.
            </p>
          </header>
        </section>
        <TemplateTable
          title="Starter templates"
          templates={starters}
          empty="Starter templates seed at boot."
        />
        <TemplateTable
          title="Your templates"
          templates={personal}
          empty="Promote any artifact into a reusable template — write {{slots}} into its content, then choose Promote."
        />
        {previewTemplate ? <TemplatePreviewPanel template={previewTemplate} /> : null}
      </div>
    </DashboardChrome>
  );
}

export interface DashboardSettingsPageProps {
  account: DashboardAccountView;
  deployment: 'self-hosted' | 'cloud';
  extensionNavItems?: DashboardNavItem[] | undefined;
  notice?: DashboardNotice | undefined;
  error?: string | undefined;
}

export function DashboardSettingsPage({
  account,
  deployment,
  extensionNavItems,
  notice,
  error,
}: DashboardSettingsPageProps) {
  const isCloud = deployment === 'cloud';
  return (
    <DashboardChrome
      title="Settings"
      account={account}
      active="settings"
      notice={notice}
      extensionNavItems={extensionNavItems}
    >
      <div class="aa-stack">
        <section class="aa-section">
          <header class="aa-section-header">
            <p class="aa-page-kicker">Settings</p>
            <h1 class="aa-section-title">Account settings</h1>
            <p class="aa-section-note">
              {isCloud
                ? 'Update your email by magic link, or permanently delete the account and all public shares.'
                : 'Update your email/password, or permanently delete the account and all public shares.'}
            </p>
          </header>
          {error ? <p class="aa-error">{error}</p> : null}
        </section>
        <div class="aa-grid aa-grid--2">
          <Card
            title="Email"
            description={
              isCloud
                ? 'Cloud email changes are confirmed by a link sent to the new address.'
                : 'Self-hosted email changes require your current password.'
            }
          >
            <form class="aa-stack" method="post" action="/dashboard/api/settings/email">
              <Input
                id="new_email"
                name="new_email"
                label="New email"
                type="email"
                value={account.email}
              />
              {isCloud ? (
                <p class="aa-hint">
                  We will email a one-time confirmation link before changing the address.
                </p>
              ) : (
                <Input
                  id="email_current_password"
                  name="current_password"
                  label="Current password"
                  type="password"
                />
              )}
              <Button variant="primary" type="submit">
                {isCloud ? 'Send confirmation link' : 'Update email'}
              </Button>
            </form>
          </Card>
          {isCloud ? (
            <Card
              title="Passwordless cloud account"
              description="Cloud dashboard access uses email links instead of local passwords."
            >
              <p class="aa-section-note">
                Password fields are intentionally unavailable in cloud mode. Sign out, then request
                a fresh magic link whenever you need to return.
              </p>
              <Button variant="secondary" href="/login?mode=magic">
                Request magic link
              </Button>
            </Card>
          ) : (
            <Card
              title="Password"
              description="Changing password rotates this session and invalidates all others."
            >
              <form class="aa-stack" method="post" action="/dashboard/api/settings/password">
                <Input
                  id="current_password"
                  name="current_password"
                  label="Current password"
                  type="password"
                />
                <Input id="new_password" name="new_password" label="New password" type="password" />
                <Input
                  id="confirm_password"
                  name="confirm_password"
                  label="Confirm new password"
                  type="password"
                />
                <Button variant="primary" type="submit">
                  Change password
                </Button>
              </form>
            </Card>
          )}
        </div>
        <Card
          title="Delete account"
          description="Hard-deletes everything you own. Existing public share URLs return 404, not 410."
        >
          <form class="aa-stack" method="post" action="/dashboard/api/settings/delete">
            <Input
              id="delete_confirm_email"
              name="confirm_email"
              label={`Type ${account.email} to delete`}
              type="email"
            />
            <Button variant="danger" type="submit">
              Delete account permanently
            </Button>
          </form>
        </Card>
      </div>
    </DashboardChrome>
  );
}

export function buildInstallPrompt({
  baseUrl,
  apiKey,
  botName,
}: {
  baseUrl: string;
  apiKey: string;
  botName: string;
}): string {
  return `You now have an Agent Artifacts account — a place to publish your work
as beautiful, versioned, shareable pages.

Your API key: ${apiKey}
Base URL: ${baseUrl}/v1

Authenticate every request with "Authorization: Bearer ${apiKey}".
Store this key somewhere you can reuse it in future sessions.
If a request returns 401, stop and tell your human — the key was
revoked or regenerated.

First, GET ${baseUrl}/v1/contract and read it — it teaches you the
whole API in one document.

From now on, whenever you produce something worth showing — a report,
a plan, a dashboard, a summary — publish it as an artifact (markdown
or html) instead of pasting a wall of text. Re-publish to the same
slug when you update it: the link stays the same and versions are
kept. Use a template from GET /v1/templates when one fits. Share
links; add a password when the content is sensitive.

Confirm setup by creating your first artifact titled
"Hello from ${botName}" and sharing its link.`;
}

export function buildArtifactCurl({
  baseUrl,
  apiKey,
  botName,
}: {
  baseUrl: string;
  apiKey: string;
  botName: string;
}): string {
  return `curl -X POST ${baseUrl}/v1/artifacts \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"slug":"hello","type":"markdown","title":"Hello from ${shellJsonSafe(botName)}","content":"# Hello\\nPublished by my bot.","share":true}'`;
}

export function buildRedactedInstallPrompt({
  baseUrl,
  last4,
  botName,
}: {
  baseUrl: string;
  last4: string;
  botName: string;
}): string {
  return buildInstallPrompt({ baseUrl, apiKey: `aa_bot_…${last4}`, botName });
}

function DashboardChrome({
  title,
  account,
  active,
  notice,
  extensionNavItems = [],
  children,
}: {
  title: string;
  account: DashboardAccountView;
  active: DashboardSection;
  notice?: DashboardNotice | undefined;
  extensionNavItems?: DashboardNavItem[] | undefined;
  children: Child;
}) {
  return (
    <Layout
      title={`${title} · Agent Artifacts`}
      description="Manage Agent Artifacts published by your bots."
    >
      <NavShell
        items={[
          { label: 'Artifacts', href: '/dashboard', current: active === 'artifacts' },
          { label: 'Bots', href: '/dashboard/bots', current: active === 'bots' },
          { label: 'Templates', href: '/dashboard/templates', current: active === 'templates' },
          { label: 'Settings', href: '/dashboard/settings', current: active === 'settings' },
          ...extensionNavItems.map((item) => ({ ...item, current: false })),
        ]}
      >
        <form class="aa-stack" method="post" action="/dashboard/api/logout">
          <span class="aa-hint">{account.email}</span>
          <Button variant="secondary" type="submit">
            Log out
          </Button>
        </form>
      </NavShell>
      <main class="aa-main">
        <div class="aa-shell aa-stack">
          <div class="aa-specimen-row">
            <Badge tone="info">{account.email}</Badge>
            <form method="post" action="/dashboard/api/logout">
              <Button variant="secondary" size="sm" type="submit">
                Log out
              </Button>
            </form>
          </div>
          {notice ? <Badge tone={notice.tone}>{notice.message}</Badge> : null}
          {children}
        </div>
      </main>
    </Layout>
  );
}

function ArtifactFilters({
  bots,
  filters,
}: {
  bots: DashboardBotView[];
  filters: DashboardHomePageProps['filters'];
}) {
  return (
    <Card
      title="Filter artifacts"
      description="Search maps to the agent API q filter: title and slug only."
    >
      <form method="get" action="/dashboard" class="aa-grid aa-grid--3">
        <Input id="q" name="q" label="Search" value={filters.q} placeholder="title or slug" />
        <Select
          id="bot"
          name="bot"
          label="Bot"
          value={filters.botId}
          options={[
            { label: 'All bots', value: '' },
            ...bots.map((bot) => ({ label: bot.name, value: bot.id })),
          ]}
        />
        <Select
          id="type"
          name="type"
          label="Type"
          value={filters.type}
          options={[
            { label: 'All types', value: '' },
            { label: 'Markdown', value: 'markdown' },
            { label: 'HTML', value: 'html' },
          ]}
        />
        <Button variant="primary" type="submit">
          Apply filters
        </Button>
      </form>
    </Card>
  );
}

function ArtifactEmptyState({
  baseUrl,
  latestBot,
}: {
  baseUrl: string;
  latestBot: DashboardBotView | null;
}) {
  const action = latestBot ? (
    <div class="aa-stack">
      <CopyBlock
        id="empty-install-prompt"
        label="Install prompt (key redacted)"
        value={buildRedactedInstallPrompt({
          baseUrl,
          botName: latestBot.name,
          last4: latestBot.apiKeyLast4,
        })}
      />
      <Button variant="secondary" href="/dashboard/bots">
        Regenerate key if you need the full value
      </Button>
    </div>
  ) : (
    <Button variant="primary" href="/dashboard/bots">
      Register a bot →
    </Button>
  );

  return (
    <EmptyState
      title="No artifacts yet — your bot creates them."
      description="Paste the install prompt into your agent and it will publish here."
      action={action}
    />
  );
}

function ArtifactRow({ artifact }: { artifact: DashboardArtifactListItem }) {
  return (
    <Card>
      <div class="aa-stack">
        <div class="aa-specimen-row">
          <a href={`/dashboard/artifacts/${artifact.id}`}>
            <strong>{artifact.title}</strong>
          </a>
          <ArtifactTypeBadge type={artifact.type} />
          {artifact.activeShare ? (
            <Badge tone="accent">
              ◆ shared{artifact.activeShare.passwordProtected ? ' · key' : ''}
            </Badge>
          ) : (
            <Badge tone="neutral">private</Badge>
          )}
          {artifact.expiresAt ? <ExpiresBadge expiresAt={artifact.expiresAt} /> : null}
        </div>
        <p class="aa-section-note">
          by {artifact.botName ?? 'unknown bot'} · <code>{artifact.slug}</code> · updated{' '}
          {formatRelativeTime(artifact.updatedAt)} · {artifact.lifetimeViews} views
        </p>
      </div>
    </Card>
  );
}

function ArtifactTypeBadge({ type }: { type: ArtifactType }) {
  return (
    <Badge tone={type === 'markdown' ? 'success' : 'info'}>
      {type === 'markdown' ? 'md' : 'html'}
    </Badge>
  );
}

function ExpiresBadge({ expiresAt }: { expiresAt: number }) {
  const days = Math.max(0, Math.ceil((expiresAt - Date.now()) / 86_400_000));
  return <Badge tone="warn">expires in {days}d</Badge>;
}

function SharePanel({ artifact }: { artifact: DashboardArtifactDetail }) {
  const share = artifact.activeShare;
  return (
    <Card
      title="Share panel"
      description={
        share
          ? 'Copy the URL, manage passwords, or revoke this link.'
          : 'Create a public share link, optionally with a password.'
      }
    >
      <div class="aa-stack" id="share-panel">
        {share ? (
          <>
            <CopyBlock id="share-url" label="Public URL" value={share.url} />
            <p class="aa-section-note">
              {share.viewCount} views on this share · {share.uniqueViewerCount} unique viewers ·{' '}
              {artifact.lifetimeViews} lifetime views ·{' '}
              {share.lastViewedAt
                ? `last viewed ${formatRelativeTime(share.lastViewedAt)}`
                : 'never viewed'}
            </p>
            {artifact.previousShareCount > 0 ? (
              <p class="aa-hint">
                Previously shared — {artifact.lifetimeViews} lifetime views across{' '}
                {artifact.previousShareCount} earlier links.
              </p>
            ) : null}
            <form
              class="aa-stack"
              method="post"
              action={`/dashboard/api/artifacts/${artifact.id}/share/password`}
            >
              <Input
                id="share_password"
                name="password"
                label={share.passwordProtected ? 'Change password' : 'Set password'}
                type="password"
              />
              <Button variant="secondary" type="submit">
                {share.passwordProtected ? 'Change password' : 'Set password'}
              </Button>
            </form>
            {share.passwordProtected ? (
              <form
                method="post"
                action={`/dashboard/api/artifacts/${artifact.id}/share/password/remove`}
              >
                <Button variant="secondary" type="submit">
                  Remove password
                </Button>
              </form>
            ) : null}
            <form
              class="aa-stack"
              method="post"
              action={`/dashboard/api/artifacts/${artifact.id}/share/revoke`}
            >
              <Input id="revoke_confirm" name="confirm" label={`Type ${artifact.slug} to revoke`} />
              <Button variant="danger" type="submit">
                Revoke link
              </Button>
            </form>
          </>
        ) : (
          <form
            class="aa-stack"
            method="post"
            action={`/dashboard/api/artifacts/${artifact.id}/share`}
          >
            <Input
              id="new_share_password"
              name="password"
              label="Password"
              type="password"
              optional
            />
            <Button variant="primary" type="submit">
              Create share link
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}

function VersionHistory({
  artifact,
  versions,
}: {
  artifact: DashboardArtifactDetail;
  versions: DashboardArtifactVersion[];
}) {
  return (
    <Card
      title="Version history"
      description="Restores create a new version; history is never rewritten."
    >
      <Table
        columns={['Version', 'Summary', 'Actions']}
        rows={versions
          .slice()
          .sort((left, right) => right.versionNum - left.versionNum)
          .map((version) => [
            <span>
              <strong>v{version.versionNum}</strong>
              <br />
              <span class="aa-hint">{formatRelativeTime(version.createdAt)}</span>
            </span>,
            <span>
              {version.changeSummary ?? 'No summary'}
              {version.restoredFromVersion ? (
                <span class="aa-hint"> · restored from v{version.restoredFromVersion}</span>
              ) : null}
            </span>,
            <div class="aa-specimen-row">
              <Button
                size="sm"
                variant="secondary"
                href={`/dashboard/artifacts/${artifact.id}?left=${version.versionNum}&right=${artifact.versionNum}`}
              >
                Diff
              </Button>
              {version.versionNum === artifact.versionNum ? (
                <Badge tone="success">current</Badge>
              ) : (
                <form method="post" action={`/dashboard/api/artifacts/${artifact.id}/restore`}>
                  <input type="hidden" name="version" value={String(version.versionNum)} />
                  <Button size="sm" variant="secondary" type="submit">
                    Restore
                  </Button>
                </form>
              )}
            </div>,
          ])}
      />
    </Card>
  );
}

function VersionDiff({
  diff,
}: {
  diff: { left: DashboardArtifactVersion; right: DashboardArtifactVersion };
}) {
  return (
    <Card
      title={`Raw diff: v${diff.left.versionNum} → v${diff.right.versionNum}`}
      description="Diff-lite shows raw side-by-side text in v1."
    >
      <div class="aa-grid aa-grid--2">
        <CopyBlock id="diff-left" label={`v${diff.left.versionNum}`} value={diff.left.content} />
        <CopyBlock id="diff-right" label={`v${diff.right.versionNum}`} value={diff.right.content} />
      </div>
    </Card>
  );
}

function PromotePanel({
  artifact,
  baseUrl,
  error,
}: {
  artifact: DashboardArtifactDetail;
  baseUrl: string;
  error: string | null;
}) {
  const slots = Array.from(new Set(artifact.content.match(/{{[a-z0-9_]+}}/g) ?? []));
  return (
    <Card
      title="Promote to template"
      description="Only markdown artifacts can become v1 templates."
    >
      <form
        class="aa-stack"
        method="post"
        action={`/dashboard/api/artifacts/${artifact.id}/promote-template`}
      >
        {artifact.type === 'html' ? (
          <p class="aa-error">Only markdown artifacts can be promoted to templates.</p>
        ) : null}
        {error ? <p class="aa-error">{error}</p> : null}
        <p class="aa-hint">
          Detected slots: {slots.length > 0 ? slots.join(' ') : 'none yet'} · {baseUrl}
        </p>
        <Input id="template_name" name="name" label="Template name" value={artifact.title} />
        <Input
          id="template_slug"
          name="slug"
          label="Template slug"
          value={`${artifact.slug}-template`}
        />
        <Textarea
          id="template_description"
          name="description"
          label="Description"
          optional
          rows={3}
        />
        <Button variant="secondary" type="submit" disabled={artifact.type === 'html'}>
          Promote markdown artifact
        </Button>
      </form>
    </Card>
  );
}

function BotKeyCard({
  baseUrl,
  apiKey,
  botName,
}: {
  baseUrl: string;
  apiKey: string;
  botName: string;
}) {
  return (
    <Card title="New key" description="This API key is shown only once.">
      <div class="aa-stack">
        <Badge tone="warn">Shown only once</Badge>
        <CopyBlock id="bot-api-key" label="API key" value={apiKey} />
        <CopyBlock
          id="bot-install-prompt"
          label="Install prompt"
          value={buildInstallPrompt({ baseUrl, apiKey, botName })}
        />
      </div>
    </Card>
  );
}

function BotActionForms({ bot }: { bot: DashboardBotView }) {
  return (
    <div class="aa-stack">
      <form class="aa-stack" method="post" action={`/dashboard/api/bots/${bot.id}/regenerate`}>
        <Input
          id={`regen_${bot.id}`}
          name="confirm_name"
          label={`Type ${bot.name} to regenerate`}
        />
        <Button variant="secondary" size="sm" type="submit">
          Regenerate key
        </Button>
      </form>
      <form class="aa-stack" method="post" action={`/dashboard/api/bots/${bot.id}/revoke`}>
        <Input id={`revoke_${bot.id}`} name="confirm_name" label={`Type ${bot.name} to revoke`} />
        <Button variant="danger" size="sm" type="submit">
          Revoke key
        </Button>
      </form>
    </div>
  );
}

function TemplatePreviewPanel({ template }: { template: DashboardTemplatePreview }) {
  return (
    <Card
      title={`Template preview: ${template.name}`}
      description="Review the raw markdown template before using it from the API."
    >
      <div class="aa-stack">
        <div class="aa-specimen-row">
          <Badge tone={template.builtIn ? 'info' : 'accent'}>
            {template.builtIn ? 'starter' : 'yours'}
          </Badge>
          <Badge tone="neutral">{template.slug}</Badge>
          <Badge tone={template.type === 'markdown' ? 'success' : 'info'}>
            {template.type === 'markdown' ? 'markdown' : 'html'}
          </Badge>
        </div>
        {template.description ? <p class="aa-section-note">{template.description}</p> : null}
        <p class="aa-hint">
          Slots:{' '}
          {template.slots.length > 0
            ? template.slots.map((slot) => <Badge tone="neutral">{`{{${slot}}}`}</Badge>)
            : 'none'}
        </p>
        <CopyBlock
          id={`template-preview-${template.id}`}
          label="Template source"
          value={template.content}
        />
      </div>
    </Card>
  );
}

function TemplateTable({
  title,
  templates,
  empty,
}: {
  title: string;
  templates: DashboardTemplateView[];
  empty: string;
}) {
  return templates.length === 0 ? (
    <Card title={title}>
      <EmptyState title={title} description={empty} />
    </Card>
  ) : (
    <Card title={title}>
      <Table
        columns={['Name', 'Slug', 'Slots', 'Action']}
        rows={templates.map((template) => [
          <span>
            <strong>{template.name}</strong>{' '}
            <Badge tone={template.builtIn ? 'info' : 'accent'}>
              {template.builtIn ? 'starter' : 'yours'}
            </Badge>
            <br />
            <span class="aa-hint">{template.description ?? 'No description'}</span>
          </span>,
          <code>{template.slug}</code>,
          <span>
            {template.slots.length > 0
              ? template.slots.map((slot) => <Badge tone="neutral">{`{{${slot}}}`}</Badge>)
              : 'none'}
          </span>,
          <Button
            size="sm"
            variant="secondary"
            href={`/dashboard/templates?preview=${template.id}`}
          >
            Preview
          </Button>,
        ])}
      />
    </Card>
  );
}

function dashboardListHref(filters: DashboardHomePageProps['filters']): string {
  const params = new URLSearchParams();
  if (filters.q) {
    params.set('q', filters.q);
  }
  if (filters.botId) {
    params.set('bot', filters.botId);
  }
  if (filters.type) {
    params.set('type', filters.type);
  }
  if (filters.cursor) {
    params.set('cursor', filters.cursor);
  }
  const query = params.toString();
  return query ? `/dashboard?${query}` : '/dashboard';
}

function formatByline(artifact: Pick<DashboardArtifactListItem, 'botName' | 'botByline'>): string {
  if (!artifact.botName) {
    return 'by unknown bot';
  }
  return artifact.botByline
    ? `by ${artifact.botName} · ${artifact.botByline}`
    : `by ${artifact.botName}`;
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

function shellJsonSafe(value: string): string {
  return value.replace(/'/g, "'\\''").replace(/"/g, '\\"');
}
