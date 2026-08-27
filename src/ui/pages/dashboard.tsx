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
  htmlPreview: string | null;
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
        {/* A search form over an empty list is dead UI at the exact moment the product has to
            teach. It stays when a filter is what emptied the list, because removing it there
            would leave no way back to the full one. */}
        {artifacts.length > 0 || filtersApplied(filters) ? (
          <ArtifactFilters bots={bots} filters={filters} />
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
            {/* `.aa-list` owns the columns and each row borrows them with subgrid, so badges and
                meta line up down the list — above 480px. Below it the pattern collapses on
                purpose: the title takes its own line and badge and meta stack beneath, because
                three tracks in 375px would push the meta off the row. Worth stating in both
                halves, since "the columns align" is true of the specimen at every width and true
                of this list only at some of them. */}
            <div class="aa-list">
              {artifacts.map((artifact) => (
                <ArtifactRow artifact={artifact} />
              ))}
            </div>
            {/* One slot, one component. It used to be a Button for one account and a neutral
                Badge for another, which made "there is more" and "that was all" different kinds
                of object rather than two states of the same one. */}
            <Pagination
              label="Artifact list pages"
              pageDescription={
                filters.nextCursor
                  ? `${formatCount(artifacts.length)} shown so far`
                  : `${formatCount(artifacts.length)} artifacts · end of list`
              }
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
            <ButtonRow>
              <h1 class="aa-section-title">{artifact.title}</h1>
              <ArtifactTypeBadge type={artifact.type} />
              {artifact.activeShare ? <Badge tone="accent">Shared</Badge> : <Badge>private</Badge>}
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
        <PromotePanel artifact={artifact} baseUrl={baseUrl} errorCode={promoteError ?? null} />
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
            <p class="aa-section-note">
              Each bot has a scoped API key, a byline, and immediate regenerate/revoke controls.
            </p>
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

        {/* First run leads with the empty state, because the copy it carries is an instruction and
            an instruction has to come before the thing it is about. Below the form it read
            "create one" while pointing back up the page at a form already scrolled past — and at
            1440 it started at y≈724, below the fold. */}
        {bots.length === 0 ? (
          <EmptyState
            id="bots-empty"
            title="Register your first bot."
            description="A bot is your agent's identity: it gets an API key, shown once, and an install prompt to paste into your agent."
            action={
              <Button variant="primary" href="#new-bot">
                Register your first bot →
              </Button>
            }
          />
        ) : null}

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
          <form class="aa-stack" id="new-bot" method="post" action="/dashboard/api/bots">
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
              New bot
            </Button>
          </form>
        </Card>

        {/* Key and Last used used to be their own columns, demoted below 480px — which put the one
            datum an operator checks before revoking from a phone behind nothing at all: no
            disclosure, no detail view, no way back to it. Folding them into the Bot cell means the
            table has two columns at every width, so there is nothing to drop. */}
        {bots.length === 0 ? null : (
          <Table
            id="dashboard-bots"
            caption="Registered bots"
            columns={['Bot', 'Actions']}
            rows={bots.map((bot) => [
              <div>
                <ButtonRow>
                  <strong>{bot.name}</strong>
                  {bot.revokedAt ? <Badge tone="danger">revoked</Badge> : null}
                </ButtonRow>
                <span class="aa-hint">{bot.byline ?? 'No byline'}</span>
                <br />
                <span class="aa-hint">
                  <code>aa_bot_…{bot.apiKeyLast4}</code> ·{' '}
                  {bot.lastUsedAt
                    ? `last used ${formatRelativeTime(bot.lastUsedAt)}`
                    : 'never used'}
                </span>
              </div>,
              <BotActions
                bot={bot}
                error={botError?.botId === bot.id ? botError.message : undefined}
              />,
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
          id="templates-starter"
          title="Starter templates"
          templates={starters}
          emptyTitle="No starter templates are installed."
          empty="Starter templates seed at boot, so this is usually a sign the seed has not run yet."
        />
        <TemplateTable
          id="templates-personal"
          title="Your templates"
          templates={personal}
          emptyTitle="No templates of your own yet."
          empty="Write {{slots}} into a markdown artifact, then choose Promote on its detail page to reuse it."
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
      {/* One mount, not one component rendered twice. The drawer footer used to carry a second
          copy, and at 375 with the drawer open both were live — which is the defect surviving the
          de-duplication of its *treatment*. Main's copy is the one that works at every width, so
          it is the one that stays. Moving it into the header (V2-N7) needs a rule in app.css to
          stand it down below the nav breakpoint, and that file is not this worker's to edit. */}
      <NavShell
        items={[
          { label: 'Artifacts', href: '/dashboard', current: active === 'artifacts' },
          { label: 'Bots', href: '/dashboard/bots', current: active === 'bots' },
          { label: 'Templates', href: '/dashboard/templates', current: active === 'templates' },
          { label: 'Settings', href: '/dashboard/settings', current: active === 'settings' },
          ...extensionNavItems.map((item) => ({ ...item, current: false })),
        ]}
      ></NavShell>
      <main class="aa-main">
        <div class="aa-shell aa-stack">
          <AccountMenu email={account.email} />
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
 * Who you are signed in as, and the way out. One component, mounted twice.
 *
 * These were two hand-rolled blocks that disagreed: in `<main>` the address was an info `Badge`
 * with a small secondary button; in the drawer footer it was hint text with a full-width one. C5
 * reserves badge tones for state, and as an info pill the identity sat directly above notice pills
 * of identical shape and size, so the product's chrome and the product's feedback read as the same
 * kind of object. Identity is text.
 *
 * The remaining half of B-G3 — mounting this once, in the header, so it is not on the page twice
 * at 375 — needs `NavShell` to host it, which is shared chrome outside this file.
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
    <Card title="Filter artifacts" description="Searches titles and slugs.">
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

/**
 * One artifact, as a row rather than a card.
 *
 * Three things move. The row is the click target instead of the title text alone, via the
 * pattern's stretched link. The title is ink, not accent — a list where every title is coloured
 * has no emphasis left for the one the reader is pointing at. And the slug comes up beside the
 * title: two artifacts can share a title, the slug is what tells them apart, and it used to sit
 * grey at the end of a meta line while the title carried all the weight.
 */
function ArtifactRow({ artifact }: { artifact: DashboardArtifactListItem }) {
  return (
    <div class="aa-list-row">
      <span class="aa-list-row__title">
        <a class="aa-list-row__link" href={`/dashboard/artifacts/${artifact.id}`}>
          {artifact.title}
        </a>
        <br />
        <span class="aa-hint">
          <code>{artifact.slug}</code> · {formatByline(artifact)}
        </span>
      </span>
      <ButtonRow>
        <ArtifactTypeBadge type={artifact.type} />
        {artifact.activeShare ? (
          <Badge tone="accent">
            Shared{artifact.activeShare.passwordProtected ? ' · password' : ''}
          </Badge>
        ) : (
          <Badge tone="neutral">private</Badge>
        )}
        {artifact.expiresAt ? <ExpiresBadge expiresAt={artifact.expiresAt} /> : null}
      </ButtonRow>
      <span class="aa-list-row__meta">
        updated {formatRelativeTime(artifact.updatedAt)} · {countOf(artifact.lifetimeViews, 'view')}
      </span>
    </div>
  );
}

/**
 * A type is not a state.
 *
 * `md` shipped as success green and `html` as info blue, which reads as a judgement on the
 * artifact and, worse, spent both tones so neither was available for anything that is actually a
 * state. Type is a neutral tag; success, warn, danger and info belong to what happened.
 */
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
              <Input
                id="share_password"
                name="password"
                label={share.passwordProtected ? 'Change password' : 'Set password'}
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
                    href={`/dashboard/artifacts/${artifact.id}?left=${version.versionNum}&right=${artifact.versionNum}`}
                  >
                    Diff
                  </Button>
                  <form method="post" action={`/dashboard/api/artifacts/${artifact.id}/restore`}>
                    <input type="hidden" name="version" value={String(version.versionNum)} />
                    <Button size="sm" variant="secondary" type="submit">
                      Restore
                    </Button>
                  </form>
                </>
              )}
            </ButtonRow>,
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
    case 'needs_a_slot':
      return 'Add at least one {{slot}} placeholder to the artifact first.';
    case 'markdown_only':
      return 'Only markdown artifacts can be promoted to templates.';
    case 'artifact_missing':
      return 'That artifact is no longer here.';
    case 'promote_unavailable':
      return 'That promotion did not go through, and no template was created.';
    default:
      return null;
  }
}

function PromotePanel({
  artifact,
  baseUrl,
  errorCode,
}: {
  artifact: DashboardArtifactDetail;
  baseUrl: string;
  errorCode: string | null;
}) {
  const error = promoteFailureMessage(errorCode);
  // An HTML artifact used to get the whole panel: a prefilled name, a prefilled slug, an editable
  // description, an error line and a submit at 55% opacity — a form the reader can type into that
  // can never be sent. State the rule once and offer nothing to fill in.
  if (artifact.type !== 'markdown') {
    return (
      <Card title="Promote to template" description="Templates fill {{slots}} in markdown.">
        <p class="aa-section-note">
          Only markdown artifacts can be promoted. Publish this content as markdown if you want a
          reusable start from it.
        </p>
      </Card>
    );
  }

  const slots = Array.from(new Set(artifact.content.match(/{{[a-z0-9_]+}}/g) ?? []));
  return (
    <Card
      title="Promote to template"
      description="Reuse this artifact's content as a start for new ones."
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
        <p class="aa-hint">Detected slots: {slots.length > 0 ? slots.join(' ') : 'none yet'}</p>
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
        <Button variant="secondary" type="submit">
          Promote markdown artifact
        </Button>
      </form>
    </Card>
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

/**
 * A revoked key has nothing left to regenerate or revoke, so the row stops offering either. The
 * controls are not rendered disabled: a disabled button is still a control the reader has to
 * reason about, and there is no state in which these two would come back for this bot.
 */
function BotActions({ bot, error }: { bot: DashboardBotView; error?: string | undefined }) {
  if (bot.revokedAt) {
    return (
      <p class="aa-hint">
        This key was revoked {formatRelativeTime(bot.revokedAt)}. Create a new bot to replace it.
      </p>
    );
  }

  // The failure and the control that produced it share one row: `ButtonRow` wraps at 12px, which
  // keeps the cell the height of its controls. `aa-stack` here would put the page-section rhythm
  // (32px) back inside a table cell, which is what made these rows ~310px tall to begin with.
  return (
    <ButtonRow>
      {error ? (
        <Notice tone="danger" title={`${bot.name} was not changed`}>
          {error}
        </Notice>
      ) : null}
      <ConfirmDestructive
        id={`regenerate-bot-${bot.id}`}
        triggerLabel="Regenerate key"
        title={`Regenerate the key for ${bot.name}?`}
        description="A replacement key is issued and shown once. The current key stops working the moment it is."
        consequence="This cannot be undone. Give your agent the new key before it next runs, or its requests will fail."
        confirmValue={bot.name}
        confirmLabel="Regenerate key"
        action={`/dashboard/api/bots/${bot.id}/regenerate`}
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
      />
    </ButtonRow>
  );
}

function TemplatePreviewPanel({ template }: { template: DashboardTemplatePreview }) {
  return (
    <Card
      title={`Template preview: ${template.name}`}
      description="Review the raw markdown template before using it from the API."
    >
      <div class="aa-stack">
        <ButtonRow>
          <Badge tone={template.builtIn ? 'info' : 'accent'}>
            {template.builtIn ? 'starter' : 'yours'}
          </Badge>
          <Badge tone="neutral">{template.slug}</Badge>
          <Badge tone="neutral">{template.type === 'markdown' ? 'md' : 'html'}</Badge>
        </ButtonRow>
        {template.description ? <p class="aa-section-note">{template.description}</p> : null}
        <p class="aa-hint">
          Slots:{' '}
          {template.slots.length > 0
            ? template.slots.map((slot) => <Badge tone="neutral">{`{{${slot}}}`}</Badge>)
            : 'none'}
        </p>
        {template.htmlPreview ? (
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
      </div>
    </Card>
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
function TemplateTable({
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
    <Card title={title}>
      <EmptyState id={id} title={emptyTitle} description={empty} action={emptyAction} />
    </Card>
  ) : (
    <Card title={title}>
      <Table
        id={id}
        label={title}
        columnPriority
        columns={[
          'Name',
          { label: 'Slug', priority: 'secondary' },
          { label: 'Slots', priority: 'secondary' },
          'Actions',
        ]}
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
  return artifact.botByline
    ? `by ${artifact.botName} (${artifact.botByline})`
    : `by ${artifact.botName}`;
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
