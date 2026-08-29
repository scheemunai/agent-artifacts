import type { Child } from 'hono/jsx';
import { Layout } from '../components/layout.js';
import {
  Badge,
  Button,
  ButtonRow,
  Card,
  ConfirmDestructive,
  CopyBlock,
  EmptyState,
  Input,
  NavShell,
  Notice,
  Pagination,
  ProductMark,
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
  thumbnailUrl: string | null;
  type: ArtifactType;
  slots: string[];
  builtIn: boolean;
}

export interface DashboardTemplatePreview extends DashboardTemplateView {
  content: string;
  htmlPreview: string | null;
  /** Absolute, sandbox-origin, token-authorised. `null` for markdown, which previews inline. */
  previewUrl: string | null;
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
          <h1 class="aa-section-title">Your agent's published work.</h1>
        </header>
        {/* A search form over an empty list is dead UI at the exact moment the product has to
            teach. It stays when a filter is what emptied the list, because removing it there
            would leave no way back to the full one. */}
        {artifacts.length > 0 || filtersApplied(filters) ? (
          <ArtifactFilters bots={bots} filters={filters} />
        ) : null}
        {artifacts.length > 0 && filtersApplied(filters) ? (
          <ButtonRow>
            <span class="aa-hint">Filtered by</span>
            {filters.q ? <Badge tone="neutral">q: {filters.q}</Badge> : null}
            {filters.botId ? <Badge tone="neutral">bot</Badge> : null}
            {filters.type ? <Badge tone="neutral">type: {filters.type}</Badge> : null}
            <Button size="sm" variant="secondary" href="/dashboard">
              Clear filters
            </Button>
          </ButtonRow>
        ) : null}
        {artifacts.length === 0 ? (
          filtersApplied(filters) ? (
            <EmptyState
              id="artifacts-no-matches"
              title="No artifacts match those filters."
              description="Widen the search, or clear the filters to see everything this account has published."
              action={
                <Button variant="secondary" href="/dashboard">
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ArtifactEmptyState baseUrl={baseUrl} latestBot={latestBot} />
          )
        ) : (
          <div class="aa-stack">
            <DashboardCardList label="Artifacts">
              {artifacts.map((artifact) => (
                <ArtifactCard artifact={artifact} />
              ))}
            </DashboardCardList>
            {/* One slot, one component. It used to be a Button for one account and a neutral
                Badge for another, which made "there is more" and "that was all" different kinds
                of object rather than two states of the same one. */}
            <Pagination
              label="Artifact list pages"
              pageDescription={pageDescription(artifacts.length, filters)}
              previousDisabled={!filters.cursor}
              nextDisabled={!filters.nextCursor}
              previousHref="/dashboard"
              {...(filters.nextCursor
                ? { nextHref: dashboardListHref({ ...filters, cursor: filters.nextCursor }) }
                : {})}
            />
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
  /** Absolute, sandbox-origin, token-authorised. `null` for markdown, which previews inline. */
  previewUrl?: string | null | undefined;
  extensionNavItems?: DashboardNavItem[] | undefined;
  notice?: DashboardNotice | undefined;
  promoteError?: string | null | undefined;
}

export function DashboardArtifactPage({
  account,
  artifact,
  versions,
  diff,
  previewUrl,
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
            <ButtonRow>
              <h1 class="aa-section-title">{artifact.title}</h1>
              <ArtifactTypeBadge type={artifact.type} />
              <ShareStateBadge artifact={artifact} />
            </ButtonRow>
            <p class="aa-section-note">
              <code>{artifact.slug}</code> · {formatByline(artifact)} · updated{' '}
              {formatRelativeTime(artifact.updatedAt)}
            </p>
          </header>
          <ButtonRow>
            <Button variant="secondary" href={`/dashboard/artifacts/${artifact.id}/download`}>
              Download
            </Button>
            <ConfirmDestructive
              id={`delete-artifact-${artifact.id}`}
              triggerLabel="Delete"
              title="Delete this artifact?"
              description={`${artifact.title} and every version of it are removed from your account.`}
              consequence="This cannot be undone. Any share link for it stops working immediately."
              confirmValue={artifact.title}
              confirmLabel="Delete artifact"
              action={`/dashboard/api/artifacts/${artifact.id}/delete`}
            />
          </ButtonRow>
        </section>

        <div class="aa-grid aa-grid--2">
          <Card
            title="Rendered preview"
            description="Owner previews use the same sanitizing/sandboxing posture as public pages."
          >
            {artifact.type === 'markdown' && artifact.htmlPreview ? (
              <div
                data-aa-dashboard-preview="markdown"
                dangerouslySetInnerHTML={{ __html: artifact.htmlPreview }}
              />
            ) : previewUrl ? (
              /*
               * Absolute and cross-origin on cloud, absolute and same-origin self-hosted — the URL
               * the route handed down, never one built here. A relative `src` is what broke this
               * card: it resolves to the dashboard origin, and the dashboard's own CSP admits only
               * the sandbox host to `frame-src`, so on cloud the browser refused the load and the
               * "Rendered preview" was blank. `sandbox="allow-scripts"` stays: the attribute keeps
               * the document in an opaque origin whichever host served it.
               */
              <iframe title={artifact.title} sandbox="allow-scripts" src={previewUrl}></iframe>
            ) : null}
          </Card>
          <SharePanel artifact={artifact} />
        </div>

        <VersionHistory artifact={artifact} versions={versions} />
        {diff ? <VersionDiff diff={diff} artifactId={artifact.id} /> : null}
        <PromotePanel artifact={artifact} errorCode={promoteError ?? null} />
      </div>
    </DashboardChrome>
  );
}

/** Which flow produced the key on screen. The two are not interchangeable: one is additive, the
 * other invalidated a key that may still be in an agent's config. */
export type BotKeyOrigin = 'created' | 'regenerated';

export interface DashboardBotsPageProps {
  account: DashboardAccountView;
  bots: DashboardBotView[];
  baseUrl: string;
  extensionNavItems?: DashboardNavItem[] | undefined;
  shownKey?: { apiKey: string; botName: string; origin: BotKeyOrigin } | undefined;
  notice?: DashboardNotice | undefined;
  /** A failure of the create form. `field` marks the one the reader has to fix. */
  createError?: { message: string; field?: 'name' } | undefined;
  /** Server-open the new-bot disclosure after a CTA reloads the page with intent. */
  newBotOpen?: boolean | undefined;
  /**
   * A failure of one bot's own control, keyed by that bot. Every bots-page error used to be
   * funnelled into the New bot card, so a failed regenerate on the fourth row reported itself as a
   * problem with creating a bot.
   */
  botError?: { botId: string; message: string } | undefined;
}

export function DashboardBotsPage({
  account,
  bots,
  baseUrl,
  extensionNavItems,
  shownKey,
  notice,
  createError,
  newBotOpen = false,
  botError,
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
          </header>
        </section>

        {/* A value that can never be shown again outranks the form that produced it. */}
        {shownKey ? (
          <BotKeyCard
            baseUrl={baseUrl}
            apiKey={shownKey.apiKey}
            botName={shownKey.botName}
            origin={shownKey.origin}
          />
        ) : null}

        <NewBotDisclosure createError={createError} defaultOpen={newBotOpen} />

        {/* The first-run state still teaches before it asks for data, but its CTA now reloads with
            intent so the disclosure opens server-side instead of hiding a validation path behind
            client-only state. */}
        {bots.length === 0 ? (
          <EmptyState
            id="bots-empty"
            title="Register your first bot."
            description="A bot is your agent's identity: it gets an API key, shown once, and an install prompt to paste into your agent."
            action={
              <Button variant="primary" href="/dashboard/bots?new_bot=1#new-bot">
                Register your first bot →
              </Button>
            }
          />
        ) : null}

        {bots.length === 0 ? null : (
          <DashboardCardList label="Registered bots">
            {bots.map((bot) => (
              <BotCard
                bot={bot}
                error={botError?.botId === bot.id ? botError.message : undefined}
              />
            ))}
          </DashboardCardList>
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
              Reusable example artifacts your agent rehashes into new work — same style, fresh
              content.
            </p>
            <p class="aa-hint">
              To add your own, open any artifact — HTML or markdown — and promote it from its detail
              page.
            </p>
          </header>
        </section>
        <TemplateGroup
          id="templates-starter"
          title="Starter templates"
          templates={starters}
          emptyTitle="No starter templates are installed."
          empty="Starter templates seed at boot, so this is usually a sign the seed has not run yet."
        />
        <TemplateGroup
          id="templates-personal"
          title="Your templates"
          templates={personal}
          emptyTitle="No templates of your own yet."
          empty="Any artifact you have published — HTML or markdown — can become one: choose Promote on its detail page, and your agent can rehash it into new work."
          emptyAction={
            <Button variant="primary" href="/dashboard">
              Pick an artifact to promote →
            </Button>
          }
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
}

export function DashboardSettingsPage({
  account,
  deployment,
  extensionNavItems,
  notice,
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
              {/* Prefilled with the current address, this could be submitted unchanged — and the
                  current address was never actually displayed anywhere. */}
              <p class="aa-hint">Currently {account.email}</p>
              <Input id="new_email" name="new_email" label="New email" type="email" value="" />
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
                  autocomplete="current-password"
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
                  autocomplete="current-password"
                />
                <Input
                  id="new_password"
                  name="new_password"
                  label="New password"
                  type="password"
                  autocomplete="new-password"
                />
                <Input
                  id="confirm_password"
                  name="confirm_password"
                  label="Confirm new password"
                  type="password"
                  autocomplete="new-password"
                />
                <Button variant="primary" type="submit">
                  Change password
                </Button>
              </form>
            </Card>
          )}
        </div>
        <Card
          tone="danger"
          title="Delete account"
          description="Removes everything you own. Shared links stop working immediately and read as missing."
        >
          <ConfirmDestructive
            id="delete-account"
            triggerLabel="Delete account permanently"
            title="Delete this account?"
            description="Everything you own goes: artifacts, versions, bots, templates and share links."
            consequence="This cannot be undone. Shared links stop working immediately and read as missing."
            confirmValue={account.email}
            confirmLabel="Delete account permanently"
            action="/dashboard/api/settings/delete"
          />
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
kept. GET ${baseUrl}/v1/templates lists example artifacts you can
rehash — fetch one that fits, keep its style, and publish your own
content in it. Share links; add a password when the content is
sensitive.

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
      {/* Identity belongs to the chrome, not to `main`. It sat in a ~100px band between the app
          header and the page's own header on every screen, which is V2-N7; it is now handed to
          NavShell, which mounts it in the header and in the drawer footer and guarantees exactly
          one is live at any width. Passing it once here is the whole point: the version where
          both were live at 375 came from two callers mounting it by hand. */}
      <NavShell
        class="aa-dashboard"
        account={<AccountMenu email={account.email} />}
        items={[
          { label: 'Artifacts', href: '/dashboard', current: active === 'artifacts' },
          { label: 'Bots', href: '/dashboard/bots', current: active === 'bots' },
          { label: 'Templates', href: '/dashboard/templates', current: active === 'templates' },
          { label: 'Settings', href: '/dashboard/settings', current: active === 'settings' },
          ...extensionNavItems.map((item) => ({ ...item, current: false })),
        ]}
      ></NavShell>
      <main class="aa-main aa-dashboard">
        <div class="aa-shell aa-stack">
          {notice ? (
            <Notice tone={notice.tone} placement="page" dismissible>
              {notice.message}
            </Notice>
          ) : null}
          {children}
        </div>
      </main>
    </Layout>
  );
}

/**
 * Who you are signed in as, and the way out.
 *
 * These were two hand-rolled blocks that disagreed: in `<main>` the address was an info `Badge`
 * with a small secondary button; in the drawer footer it was hint text with a full-width one. C5
 * reserves badge tones for state, and as an info pill the identity sat directly above notice pills
 * of identical shape and size, so the product's chrome and the product's feedback read as the same
 * kind of object. Identity is text.
 *
 * It carries no `id` and must not grow one. NavShell renders this in two places from a single
 * prop, so an id here would become a duplicate id on every dashboard page — the cost of the
 * component owning the one-live-copy invariant instead of asking its callers to.
 */
function AccountMenu({ email }: { email: string }) {
  return (
    <ButtonRow>
      <span class="aa-hint">{email}</span>
      <form method="post" action="/dashboard/api/logout">
        <Button variant="secondary" size="sm" type="submit">
          Log out
        </Button>
      </form>
    </ButtonRow>
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
    <form method="get" action="/dashboard" class="aa-dashboard-filter-bar">
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
      <div class="aa-dashboard-filter-bar__actions">
        <Button variant="primary" size="sm" type="submit">
          Apply filters
        </Button>
      </div>
    </form>
  );
}

/**
 * The action slot holds one next step. The install prompt is content, so it gets a card.
 *
 * Putting a ~350px `CopyBlock` in the action slot made the empty state the largest object on the
 * page — a white card inside a dashed card inside a grey slab — and the slot's inherited
 * `text-align: center` rendered the preformatted prompt centre-aligned line by line.
 */
function ArtifactEmptyState({
  baseUrl,
  latestBot,
}: {
  baseUrl: string;
  latestBot: DashboardBotView | null;
}) {
  if (!latestBot) {
    return (
      <EmptyState
        id="artifacts-no-bot"
        title="No artifacts yet — your bot creates them."
        description="Register a bot first: it gets an API key, and the install prompt that teaches your agent to publish here."
        action={
          <Button variant="primary" href="/dashboard/bots">
            Register a bot →
          </Button>
        }
      />
    );
  }

  return (
    <>
      <EmptyState
        id="artifacts-with-bot"
        title="No artifacts yet — your bot creates them."
        description="Paste the install prompt below into your agent and its first artifact will appear here."
        action={
          <Button variant="secondary" href="/dashboard/bots">
            Manage bots
          </Button>
        }
      />
      <Card
        title={`Install prompt for ${latestBot.name}`}
        description="The key is redacted here. Regenerate it on the Bots page if you need the full value."
      >
        <CopyBlock
          id="empty-install-prompt"
          label="Install prompt (key redacted)"
          value={buildRedactedInstallPrompt({
            baseUrl,
            botName: latestBot.name,
            last4: latestBot.apiKeyLast4,
          })}
        />
      </Card>
    </>
  );
}

export interface DashboardCardListProps {
  children: Child;
  label?: string | undefined;
  class?: string | undefined;
}

export function DashboardCardList({ children, label, class: className }: DashboardCardListProps) {
  return (
    <ul
      class={className ? `aa-dashboard-card-list ${className}` : 'aa-dashboard-card-list'}
      aria-label={label}
    >
      {children}
    </ul>
  );
}

export interface DashboardCardProps {
  title: Child;
  href?: string | undefined;
  subline?: Child | undefined;
  badges?: Child | undefined;
  meta?: Child | undefined;
  notice?: Child | undefined;
  actions?: Child | undefined;
  class?: string | undefined;
}

/**
 * The dashboard list card: leading identity, trailing status, durable meta and optional actions.
 *
 * The component stays content-agnostic on purpose. Artifacts wire it to title/slug/share state
 * now; Bots and Templates can hand it their own identity, status and action slot without
 * re-inventing the raised white-card list pattern.
 */
export function DashboardCard({
  title,
  href,
  subline,
  badges,
  meta,
  notice,
  actions,
  class: className,
}: DashboardCardProps) {
  const classes = [
    'aa-dashboard-card',
    href && 'aa-dashboard-card--linked',
    actions && 'aa-dashboard-card--with-actions',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li class={classes}>
      <div class="aa-dashboard-card__topline">
        <div class="aa-dashboard-card__leading">
          <h3 class="aa-dashboard-card__title">
            {href ? (
              <a class="aa-dashboard-card__link" href={href}>
                {title}
              </a>
            ) : (
              title
            )}
          </h3>
          {subline ? <p class="aa-dashboard-card__subline">{subline}</p> : null}
        </div>
        {badges ? <div class="aa-dashboard-card__badges">{badges}</div> : null}
      </div>
      {notice ? <div class="aa-dashboard-card__notice">{notice}</div> : null}
      {meta || actions ? (
        <div class="aa-dashboard-card__footer">
          {meta ? <p class="aa-dashboard-card__meta">{meta}</p> : null}
          {actions ? <div class="aa-dashboard-card__actions">{actions}</div> : null}
        </div>
      ) : null}
    </li>
  );
}

function ArtifactCard({ artifact }: { artifact: DashboardArtifactListItem }) {
  return (
    <DashboardCard
      title={artifact.title}
      href={`/dashboard/artifacts/${artifact.id}`}
      subline={
        <>
          <code>{artifact.slug}</code> · {formatByline(artifact)}
        </>
      }
      badges={
        <>
          <ShareStateBadge artifact={artifact} />
          <ArtifactTypeBadge type={artifact.type} />
          {artifact.expiresAt ? <ExpiresBadge expiresAt={artifact.expiresAt} /> : null}
        </>
      }
      meta={
        <>
          updated {formatRelativeTime(artifact.updatedAt)} ·{' '}
          {countOf(artifact.lifetimeViews, 'view')}
        </>
      }
    />
  );
}

/**
 * A type is not a state.
 *
 * `md` shipped as success green and `html` as info blue, which reads as a judgement on the
 * artifact and, worse, spent both tones so neither was available for anything that is actually a
 * state. Type is a neutral tag; success, warn, danger and info belong to what happened.
 */
/**
 * One share state, one rendering, wherever it appears.
 *
 * The list said "Shared · password" while the detail header of the same artifact said only
 * "Shared" — the discriminator lived 500px further down in the panel, so the header quietly
 * disagreed with the row that led to it. And a revoked link rendered the same neutral "private"
 * as an artifact that had never been shared, which are opposite facts: one was never public, the
 * other was and was pulled back. `previousShareCount` already knew.
 */
function ShareStateBadge({
  artifact,
}: {
  artifact: Pick<DashboardArtifactListItem, 'activeShare' | 'previousShareCount'>;
}) {
  if (artifact.activeShare) {
    if (artifact.activeShare.passwordProtected) {
      return (
        <Badge tone="info">
          <span aria-hidden="true">🔒</span>
          Password-protected
        </Badge>
      );
    }
    return <Badge tone="success">Public</Badge>;
  }
  if (artifact.previousShareCount > 0) {
    return <Badge tone="warn">Link revoked</Badge>;
  }
  return <Badge tone="neutral">Private</Badge>;
}

function ArtifactTypeBadge({ type }: { type: ArtifactType }) {
  return <Badge tone="neutral">{type === 'markdown' ? 'md' : 'html'}</Badge>;
}

/**
 * The badge clamped its countdown at zero but kept the future tense, so an artifact that had
 * already gone read "expires in 0d" — a statement about the future that was false about the past.
 * Past, present and future each get their own sentence.
 */
function ExpiresBadge({ expiresAt }: { expiresAt: number }) {
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) {
    return <Badge tone="danger">expired</Badge>;
  }
  const days = Math.ceil(remainingMs / 86_400_000);
  return <Badge tone="warn">{days <= 1 ? 'expires today' : `expires in ${days}d`}</Badge>;
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
              {countOf(share.viewCount, 'view')} on this share ·{' '}
              {countOf(share.uniqueViewerCount, 'unique viewer')} ·{' '}
              {countOf(artifact.lifetimeViews, 'lifetime view')} ·{' '}
              {share.lastViewedAt
                ? `last viewed ${formatRelativeTime(share.lastViewedAt)}`
                : 'never viewed'}
            </p>
            {artifact.previousShareCount > 0 ? (
              <p class="aa-hint">
                Previously shared — {countOf(artifact.lifetimeViews, 'lifetime view')} across{' '}
                {countOf(artifact.previousShareCount, 'earlier link')}.
              </p>
            ) : null}
            <form
              class="aa-stack"
              method="post"
              action={`/dashboard/api/artifacts/${artifact.id}/share/password`}
            >
              {/* One ternary used to feed this label AND the button below it, so a label sat 44px
                  above a button reading the same words. A field is named for what it holds; only
                  the action changes with the state. */}
              <Input
                id="share_password"
                name="password"
                label="New password"
                type="password"
                autocomplete="new-password"
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
            <ConfirmDestructive
              id={`revoke-share-${artifact.id}`}
              triggerLabel="Revoke link"
              title="Revoke this share link?"
              description="The public page stops resolving for everyone who already has the link."
              consequence="This cannot be undone. Sharing again creates a new link, never this one."
              confirmValue={artifact.slug}
              confirmLabel="Revoke link"
              action={`/dashboard/api/artifacts/${artifact.id}/share/revoke`}
            />
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
              autocomplete="new-password"
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
      {/* `columnPriority` is load-bearing, not decoration. `.aa-table` forces a 42rem minimum, so
          without it this table scrolls at 375 and every Diff and Restore sits ~157px past the right
          edge behind a scroll nobody signposted — measured, not assumed: the Diff control ended at
          532px in a 375px viewport. That is the defect 178f849 fixed for all three dashboard
          tables, and it came back when the flag was dropped from this one table. The Summary column
          is the demoted one on purpose: a reader who cannot reach a control is worse off than one
          who cannot read a change summary. No Actions column is `secondary` anywhere. */}
      <Table
        id="artifact-versions"
        label="Version history"
        columnPriority
        columns={['Version', { label: 'Summary', priority: 'secondary' }, 'Actions']}
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
            <ButtonRow>
              {/* The current version's Diff pointed at `?left=N&right=N` — a version compared
                  with itself. There is nothing to show, so there is nothing to offer. */}
              {version.versionNum === artifact.versionNum ? (
                <Badge tone="success">current</Badge>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    href={`/dashboard/artifacts/${artifact.id}?left=${version.versionNum}&right=${artifact.versionNum}#version-diff`}
                  >
                    Diff
                  </Button>
                  {/* Restore rewrites what every reader of the current version sees, and it was
                      one click while revoking a link demanded a typed slug — the ladder ran the
                      wrong way round. The typed value is the version number rather than ceremony:
                      restoring is reversible, restoring the WRONG version is the mistake, so the
                      reader confirms the one parameter that makes this dangerous. */}
                  <ConfirmDestructive
                    id={`restore-version-${version.versionNum}`}
                    triggerLabel="Restore"
                    title={`Restore v${version.versionNum}?`}
                    description={`The current version becomes a copy of v${version.versionNum}. Anyone opening this artifact sees that content instead.`}
                    consequence="History is kept, so this can be undone by restoring again — but every share link shows the restored content immediately."
                    confirmValue={`v${version.versionNum}`}
                    confirmLabel={`Restore v${version.versionNum}`}
                    action={`/dashboard/api/artifacts/${artifact.id}/restore`}
                    fields={{ version: String(version.versionNum) }}
                  />
                </>
              )}
            </ButtonRow>,
          ])}
      />
    </Card>
  );
}

/**
 * The diff, somewhere the browser actually goes.
 *
 * Both revealed panels in this product were plain hrefs: the page reloaded at scrollY 0 with the
 * revealed thing ~1250px below the fold, so pressing the control looked like nothing happening.
 * The fragment moves the viewport; `tabindex={-1}` is what moves the reader's place in the
 * document along with it, so the next Tab continues from the panel rather than the top.
 * And what can be opened can be closed: editing the URL was the only exit.
 */
function VersionDiff({
  diff,
  artifactId,
}: {
  diff: { left: DashboardArtifactVersion; right: DashboardArtifactVersion };
  artifactId: string;
}) {
  return (
    <section id="version-diff" tabindex={-1}>
      <Card
        title={`Raw diff: v${diff.left.versionNum} → v${diff.right.versionNum}`}
        description="Diff-lite shows raw side-by-side text in v1."
      >
        <div class="aa-grid aa-grid--2">
          <CopyBlock id="diff-left" label={`v${diff.left.versionNum}`} value={diff.left.content} />
          <CopyBlock
            id="diff-right"
            label={`v${diff.right.versionNum}`}
            value={diff.right.content}
          />
        </div>
        <ButtonRow>
          <Button variant="secondary" href={`/dashboard/artifacts/${artifactId}`}>
            Close diff
          </Button>
        </ButtonRow>
      </Card>
    </section>
  );
}

/**
 * Server-owned copy for a promote refusal, looked up from the code the route put in the URL.
 *
 * The route decides WHICH refusal happened; this decides how to say it. Keeping the sentence on
 * this side is what makes the query parameter a closed vocabulary — an unknown code says nothing
 * rather than printing whatever it was handed.
 */
function promoteFailureMessage(code: string | null): string | null {
  switch (code) {
    case 'slug_taken':
      return 'That template slug is already in use. Choose another.';
    // `needs_a_slot` and `markdown_only` were retired with the refusals that produced them. A
    // template is a reference example now, so neither "this is HTML" nor "this declares no slots"
    // is a reason to say no, and the service stopped raising them. Their sentences are gone from
    // this vocabulary too: a message with no reachable cause is a claim the product can no longer
    // make, and leaving it here only preserves the chance of printing it by accident.
    case 'invalid_slot_marker':
      return 'One of the {{slot}} markers in this artifact is malformed. Fix it and try again.';
    case 'artifact_missing':
      return 'That artifact is no longer here.';
    case 'promote_invalid':
      // The honest generic. It reaches here when the cause was not one this vocabulary knows, and
      // it says so rather than picking the most likely-sounding neighbour — naming a cause nobody
      // verified is what produced V10-N2. Vague and true beats specific and wrong.
      return 'Something in that form did not pass validation, and no template was created.';
    case 'promote_unavailable':
      return 'That promotion did not go through, and no template was created.';
    default:
      return null;
  }
}

/**
 * The refusals that belong to a field rather than to the form.
 *
 * A slug the schema rejected is an error about the slug box, and the reader is looking at the slug
 * box — so it goes there, through the same `Input.error` machinery every other field in the product
 * uses, instead of into a notice above the form that makes the reader hunt for which input it means.
 * The C1/C9 rule: an error that has an address is delivered to it.
 */
const PROMOTE_FIELD_ERRORS: Record<string, { field: 'name' | 'slug'; message: string }> = {
  slug_invalid: {
    field: 'slug',
    message: 'Use lowercase letters, numbers and hyphens — no spaces or punctuation.',
  },
  slug_taken: { field: 'slug', message: 'That template slug is already in use. Choose another.' },
  name_invalid: { field: 'name', message: 'Give the template a name of at least one character.' },
};

function PromotePanel({
  artifact,
  errorCode,
}: {
  artifact: DashboardArtifactDetail;
  errorCode: string | null;
}) {
  // A field refusal is delivered to its field and NOT repeated in the notice: saying it twice makes
  // the reader check whether they are two different problems.
  const fieldError = errorCode ? PROMOTE_FIELD_ERRORS[errorCode] : undefined;
  const error = fieldError ? null : promoteFailureMessage(errorCode);
  // Slots are an optional extra, not the price of entry. The panel used to hard-block anything that
  // was not markdown — "Only markdown artifacts can be promoted", beside a card described as
  // "Templates fill {{slots}} in markdown" — which described a product that no longer exists: a
  // template is a reference EXAMPLE the agent rehashes, and an HTML page is the best example there
  // is. The service accepts both types and accepts no slots at all, so the form is offered for both
  // and the slot line only appears when there is something to say.
  const slots = Array.from(new Set(artifact.content.match(/{{[a-z0-9_]+}}/g) ?? []));
  return (
    <Card
      title="Promote to template"
      description="Save this as a reusable example your agent can rehash into new work — same style, fresh content."
      notice={
        error ? (
          <Notice tone="danger" title="That template was not created">
            {error}
          </Notice>
        ) : undefined
      }
    >
      <form
        class="aa-stack"
        method="post"
        action={`/dashboard/api/artifacts/${artifact.id}/promote-template`}
      >
        {slots.length > 0 ? (
          <p class="aa-hint">Slots your agent can fill: {slots.join(' ')}</p>
        ) : null}
        <Input
          id="template_name"
          name="name"
          label="Template name"
          value={artifact.title}
          {...(fieldError?.field === 'name' ? { error: fieldError.message } : {})}
        />
        <Input
          id="template_slug"
          name="slug"
          label="Template slug"
          value={`${artifact.slug}-template`}
          {...(fieldError?.field === 'slug' ? { error: fieldError.message } : {})}
        />
        <Textarea
          id="template_description"
          name="description"
          label="Description"
          optional
          rows={3}
        />
        <Button variant="secondary" type="submit">
          Save as template
        </Button>
      </form>
    </Card>
  );
}

function NewBotDisclosure({
  createError,
  defaultOpen,
}: {
  createError?: DashboardBotsPageProps['createError'];
  defaultOpen: boolean;
}) {
  const open = Boolean(createError) || defaultOpen;

  return (
    <details class="aa-dashboard-disclosure" id="new-bot" open={open ? true : undefined}>
      <summary class="aa-btn aa-btn--primary aa-dashboard-disclosure__summary">
        <span>New bot</span>
      </summary>
      <div class="aa-dashboard-disclosure__panel">
        <Card
          title="New bot"
          description="The key appears once after creation."
          notice={
            createError && !createError.field ? (
              <Notice tone="danger" title="That bot was not created">
                {createError.message}
              </Notice>
            ) : undefined
          }
        >
          <form class="aa-stack" id="new-bot-form" method="post" action="/dashboard/api/bots">
            <Input
              id="name"
              name="name"
              label="Bot name"
              placeholder="Research bot"
              error={createError?.field === 'name' ? createError.message : undefined}
            />
            <Input
              id="byline"
              name="byline"
              label="Byline"
              placeholder="Research assistant"
              optional
            />
            <Button variant="primary" type="submit">
              Create bot
            </Button>
          </form>
        </Card>
      </div>
    </details>
  );
}

/**
 * The one-time key, with the outcome that produced it attached to it.
 *
 * Both flows used to render a card titled "New key" that never named its bot, so the screen after
 * creating a bot and the screen after invalidating a live one were indistinguishable — and the only
 * signal that the old key had just stopped working was a success-green pill ~780px above. The title
 * names the bot, and the notice sits in the card's own notice slot, between its header and the key.
 */
function BotKeyCard({
  baseUrl,
  apiKey,
  botName,
  origin,
}: {
  baseUrl: string;
  apiKey: string;
  botName: string;
  origin: BotKeyOrigin;
}) {
  const regenerated = origin === 'regenerated';

  return (
    <Card
      title={`${regenerated ? 'Regenerated' : 'New'} key for ${botName}`}
      description="This API key is shown only once. Copy it before you leave this page."
      notice={
        regenerated ? (
          <Notice tone="warn" title={`The previous key for ${botName} stopped working`}>
            Anything still authenticating with it is rejected from now on. Give your agent the key
            below before it next runs.
          </Notice>
        ) : (
          <Notice tone="success" title={`${botName} is registered`}>
            Copy the key below now — it is never shown again.
          </Notice>
        )
      }
    >
      <div class="aa-stack">
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

function BotCard({ bot, error }: { bot: DashboardBotView; error?: string | undefined }) {
  return (
    <DashboardCard
      title={
        <span class="aa-dashboard-card__title-row">
          <strong>{bot.name}</strong>
          {bot.revokedAt ? <Badge tone="danger">revoked</Badge> : null}
        </span>
      }
      subline={bot.byline ?? 'No byline'}
      meta={
        <>
          <code>aa_bot_…{bot.apiKeyLast4}</code> ·{' '}
          {bot.lastUsedAt ? `last used ${formatRelativeTime(bot.lastUsedAt)}` : 'never used'}
        </>
      }
      notice={
        error ? (
          <Notice tone="danger" title={`${bot.name} was not changed`}>
            {error}
          </Notice>
        ) : undefined
      }
      actions={<BotActions bot={bot} />}
    />
  );
}

/**
 * A revoked key has nothing left to regenerate or revoke, so the row stops offering either. The
 * controls are not rendered disabled: a disabled button is still a control the reader has to
 * reason about, and there is no state in which these two would come back for this bot.
 */
function BotActions({ bot }: { bot: DashboardBotView }) {
  if (bot.revokedAt) {
    return (
      <p class="aa-hint">
        This key was revoked {formatRelativeTime(bot.revokedAt)}. Create a new bot to replace it.
      </p>
    );
  }

  return (
    <ButtonRow>
      <ConfirmDestructive
        id={`regenerate-bot-${bot.id}`}
        triggerLabel="Regenerate key"
        title={`Regenerate the key for ${bot.name}?`}
        description="A replacement key is issued and shown once. The current key stops working the moment it is."
        consequence="This cannot be undone. Give your agent the new key before it next runs, or its requests will fail."
        confirmValue={bot.name}
        confirmLabel="Regenerate key"
        action={`/dashboard/api/bots/${bot.id}/regenerate`}
        size="sm"
      />
      <ConfirmDestructive
        id={`revoke-bot-${bot.id}`}
        triggerLabel="Revoke key"
        title={`Revoke the key for ${bot.name}?`}
        description="The key stops authenticating immediately and no replacement is issued."
        consequence="This cannot be undone. Every request this bot makes afterwards is rejected."
        confirmValue={bot.name}
        confirmLabel="Revoke key"
        action={`/dashboard/api/bots/${bot.id}/revoke`}
        size="sm"
      />
    </ButtonRow>
  );
}

/**
 * The preview shows the example, then the source.
 *
 * A template is an example artifact an agent rehashes, so the first question a reader has is what
 * it looks like — and for an HTML template the source answers that only if you can read CSS. The
 * HTML branch therefore renders the template through the same sandboxed frame the owner preview of
 * an HTML artifact uses (`/preview/:token/frame` on the sandbox origin, owner-preview CSP), and
 * markdown keeps its server-rendered `htmlPreview`. The source block stays either way: it is what
 * the agent actually receives from the API.
 *
 * Slots are listed only when there are any. "Slots: none" on the three HTML examples that declare
 * none was a field-form frame on something that is not a form.
 */
function TemplatePreviewPanel({ template }: { template: DashboardTemplatePreview }) {
  const isHtml = template.type === 'html';
  return (
    <section id="template-preview" tabindex={-1}>
      <Card
        title={`Template preview: ${template.name}`}
        description={
          isHtml
            ? 'The example as it renders. Owner previews use the same sandboxing posture as public pages.'
            : 'The example as it renders, and the source your agent receives from the API.'
        }
      >
        <div class="aa-stack">
          <ButtonRow>
            <Badge tone={template.builtIn ? 'info' : 'accent'}>
              {template.builtIn ? 'starter' : 'yours'}
            </Badge>
            <code>{template.slug}</code>
            <Badge tone="neutral">{template.type === 'markdown' ? 'md' : 'html'}</Badge>
          </ButtonRow>
          {template.description ? <p class="aa-section-note">{template.description}</p> : null}
          {template.slots.length > 0 ? (
            <p class="aa-hint">
              Slots your agent can fill:{' '}
              {template.slots.map((slot) => (
                <Badge tone="neutral">{`{{${slot}}}`}</Badge>
              ))}
            </p>
          ) : null}
          {isHtml && template.previewUrl ? (
            <iframe
              class="aa-template-frame"
              title={`${template.name} example`}
              sandbox="allow-scripts"
              src={template.previewUrl}
            ></iframe>
          ) : null}
          {!isHtml && template.htmlPreview ? (
            <div
              data-aa-dashboard-template-preview="markdown"
              dangerouslySetInnerHTML={{ __html: template.htmlPreview }}
            />
          ) : null}
          <CopyBlock
            id={`template-preview-${template.id}`}
            label="Template source"
            value={template.content}
          />
          <ButtonRow>
            <Button variant="secondary" href="/dashboard/templates">
              Close preview
            </Button>
          </ButtonRow>
        </div>
      </Card>
    </section>
  );
}

/**
 * The empty state names the state, never the section.
 *
 * This card used to render `Card title="Your templates"` around `EmptyState title="Your
 * templates"` — the same heading twice, 60px apart — because the empty state was handed the
 * section's title for want of one of its own. A heading repeated is a heading that stops being
 * read; and with nothing to do next, the state described the absence and left the reader in it.
 */
function TemplateGroup({
  id,
  title,
  templates,
  emptyTitle,
  empty,
  emptyAction,
}: {
  id: string;
  title: string;
  templates: DashboardTemplateView[];
  emptyTitle: string;
  empty: string;
  emptyAction?: Child | undefined;
}) {
  return templates.length === 0 ? (
    <section class="aa-dashboard-group" aria-labelledby={`${id}-heading`}>
      <h2 class="aa-dashboard-group__title" id={`${id}-heading`}>
        {title}
      </h2>
      <EmptyState id={`${id}-empty`} title={emptyTitle} description={empty} action={emptyAction} />
    </section>
  ) : (
    <section class="aa-dashboard-group" aria-labelledby={`${id}-heading`}>
      <h2 class="aa-dashboard-group__title" id={`${id}-heading`}>
        {title}
      </h2>
      <DashboardCardList label={title} class="aa-template-grid">
        {templates.map((template) => (
          <TemplateCard template={template} />
        ))}
      </DashboardCardList>
    </section>
  );
}

/**
 * A template is shown, not described.
 *
 * The row this replaces led with a name, a slug and a strip of `{{slot}}` pills — an index of
 * fields, which is the wrong claim about the thing. A template here is a finished example artifact
 * an agent rehashes into new work, so the card leads with the example's own picture and the reader
 * decides by looking. The slot pills are gone from the listing entirely; the merge fields still
 * exist for markdown templates and are named in the preview, where they answer a question the
 * reader has actually asked by then.
 *
 * It is a template-specific card rather than `DashboardCard` because the cover image changes the
 * card's shape, not its trim, and Artifacts and Bots must not inherit that.
 */
function TemplateCard({ template }: { template: DashboardTemplateView }) {
  const href = `/dashboard/templates?preview=${template.id}#template-preview`;
  return (
    <li class="aa-template-card">
      {/* The cover is the card's own link target via the stretched pseudo-element below, so it
          carries no separate control and the image is decorative: the name beside it is the
          accessible name of the one link. */}
      <div class="aa-template-card__cover">
        {template.thumbnailUrl ? (
          <img class="aa-template-card__image" src={template.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <TemplateCoverPlaceholder />
        )}
      </div>
      <div class="aa-template-card__body">
        <h3 class="aa-template-card__title">
          <a class="aa-template-card__link" href={href}>
            {template.name}
          </a>
        </h3>
        <div class="aa-template-card__badges">
          <Badge tone={template.builtIn ? 'info' : 'accent'}>
            {template.builtIn ? 'starter' : 'yours'}
          </Badge>
          <Badge tone="neutral">{template.type === 'markdown' ? 'md' : 'html'}</Badge>
        </div>
        <p class="aa-template-card__subline">
          {template.description ?? 'No description yet — open the preview to see the example.'}
        </p>
        <div class="aa-template-card__actions">
          <Button size="sm" variant="secondary" href={href}>
            Preview
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * The cover for a template that has no picture of its own.
 *
 * Every built-in ships a rendered thumbnail; a template you promote from your own artifact has
 * none, and `<img src="">` on a null is a broken-image glyph in the middle of a grid of real ones.
 * This fills the same 16:10 box with the product mark on a tinted tile — a cover that reads as
 * deliberate rather than as a failed load.
 *
 * The mark is all of it. It first carried the template's name and type as well, which the card
 * body prints again immediately below: on a personal card the name appeared twice, 30px apart,
 * and the type both as a word and as a badge. A thumbnail on a built-in card carries no caption
 * either, so a bare tile is also the consistent one.
 */
function TemplateCoverPlaceholder() {
  return (
    <div class="aa-template-card__placeholder" aria-hidden="true">
      <ProductMark />
    </div>
  );
}

/**
 * What the number in the pagination meta is counting.
 *
 * "8 artifacts · end of list" on a 28-artifact account read as "this account has 8" — one string
 * doing two jobs depending on how the reader got there. Only the first page can honestly claim
 * to be counting the whole set; past a cursor the count is of this page and says so. A true
 * running total would need a count the list query does not currently make.
 */
function pageDescription(shown: number, filters: DashboardHomePageProps['filters']): string {
  if (filters.nextCursor) {
    return `${formatCount(shown)} shown so far`;
  }
  return filters.cursor
    ? `${formatCount(shown)} on this page · end of list`
    : `${formatCount(shown)} artifacts · end of list`;
}

/** Whether the reader narrowed the list themselves. `cursor` is paging, not filtering. */
function filtersApplied(filters: DashboardHomePageProps['filters']): boolean {
  return Boolean(filters.q || filters.botId || filters.type);
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
  // The interpunct separates unrelated meta fields elsewhere in this line, so using it here too
  // made one bot read as two. Parentheses subordinate the byline to the name it describes.
  if (!artifact.botByline) {
    return `by ${artifact.botName}`;
  }
  // A long byline wrapped mid-parenthetical and left "bot)" alone on its own line under a
  // two-line title. Binding the last word to the one before it with a non-breaking space means
  // the smallest thing that can wrap is two words plus the bracket — the typographic widow fix,
  // and it needs no stylesheet.
  return `by ${artifact.botName} (${bindFinalWord(artifact.botByline)})`;
}

/** Joins the last two words with a non-breaking space, so a lone word cannot end up orphaned. */
function bindFinalWord(text: string): string {
  return text.replace(/\s+(\S+)$/, '\u00a0$1');
}

/** Counts are read, not parsed: a grouped 50,000 is a number, 50000 is a digit string. */
function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * A count and its noun, agreeing.
 *
 * The share stats interpolated into fixed plurals, so a freshly-viewed artifact reported
 * "1 views on this share · 1 unique viewers · 1 lifetime views" — three disagreements in one
 * line, on the screen an owner sees right after their first visitor.
 */
function countOf(value: number, noun: string): string {
  return `${formatCount(value)} ${noun}${value === 1 ? '' : 's'}`;
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
