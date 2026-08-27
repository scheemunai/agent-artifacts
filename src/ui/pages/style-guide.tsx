import type { Child } from 'hono/jsx';
import { Layout } from '../components/layout.js';
import {
  MarketingApiBlock,
  MarketingArtifactEmbed,
  MarketingExampleCard,
  MarketingFeatureLine,
  MarketingOriginNote,
  MarketingWorksWith,
} from '../components/marketing.js';
import {
  Avatar,
  Badge,
  type BadgeTone,
  Button,
  type ButtonVariant,
  Card,
  type ComponentState,
  ConfirmationDialog,
  CopyBlock,
  Dialog,
  EmptyState,
  Input,
  NavShell,
  Pagination,
  ProductMark,
  Select,
  Skeleton,
  Spinner,
  Table,
  Tabs,
  Textarea,
  Toast,
  ToastRegion,
} from '../components/primitives.js';

interface TokenSpec {
  name: string;
  intent: string;
  swatch?: string;
}

const colorTokens: TokenSpec[] = [
  { name: '--color-aa-bg', intent: 'Fresh Air ground. Use once per page.', swatch: 'bg' },
  {
    name: '--color-aa-surface',
    intent: 'Hairline surfaces and quiet table heads.',
    swatch: 'surface',
  },
  {
    name: '--color-aa-surface-raised',
    intent: 'Cards, dialogs, toasts, inputs, and other raised surfaces.',
    swatch: 'surface-raised',
  },
  {
    name: '--color-aa-surface-tint',
    intent: 'The single coral tint for origin notes and callouts.',
    swatch: 'surface-tint',
  },
  {
    name: '--color-aa-ink',
    intent: 'Slate primary text. Default for readable content.',
    swatch: 'ink',
  },
  { name: '--color-aa-muted', intent: 'Secondary text and quiet navigation.', swatch: 'muted' },
  {
    name: '--color-aa-subtle',
    intent: 'Placeholders, timestamps, optional labels.',
    swatch: 'subtle',
  },
  { name: '--color-aa-line', intent: 'Hairline borders and separators.', swatch: 'line' },
  {
    name: '--color-aa-accent',
    intent: 'The single coral accent. Use sparingly for primary action and state.',
    swatch: 'accent',
  },
  {
    name: '--color-aa-success',
    intent: 'Positive confirmation and completed status.',
    swatch: 'success',
  },
  { name: '--color-aa-warn', intent: 'Recoverable caution and expiring status.', swatch: 'warn' },
  {
    name: '--color-aa-danger',
    intent: 'Destructive actions and blocking errors.',
    swatch: 'danger',
  },
  { name: '--color-aa-info', intent: 'Neutral system information.', swatch: 'info' },
  {
    name: '--color-aa-dark-card',
    intent: 'The only dark surface: API examples and code moments.',
    swatch: 'dark-card',
  },
];

const typeTokens: TokenSpec[] = [
  { name: '--font-sans', intent: 'Source Sans 3 first, system fallback. Used for product UI.' },
  { name: '--font-mono', intent: 'Keys, code, curl examples, and compact technical data.' },
  { name: '--text-aa-xs', intent: 'Badges, captions, and compact metadata.' },
  { name: '--text-aa-sm', intent: 'Buttons, hints, inputs, table cells, navigation.' },
  { name: '--text-aa-base', intent: 'Default UI body copy.' },
  { name: '--text-aa-lg', intent: 'Page ledes and emphasized supporting copy.' },
  { name: '--text-aa-2xl', intent: 'Section titles.' },
  { name: '--text-aa-hero', intent: 'Homepage-sized hero statements.' },
];

const spaceTokens: TokenSpec[] = [
  { name: '--spacing-aa-1 → --spacing-aa-16', intent: 'A compact, predictable spacing ramp.' },
  {
    name: '--spacing-aa-touch',
    intent: 'Minimum 44px interactive height inherited by every button size and form control.',
  },
  {
    name: '--radius-aa-xs → --radius-aa-xl',
    intent: 'Restrained radii for code, controls, cards.',
  },
  { name: '--radius-aa-full', intent: 'Badges, avatars, and spinner circles.' },
  { name: '--shadow-aa-sm', intent: 'One-pixel lift for cards and controls.' },
  { name: '--shadow-aa-md', intent: 'Toasts and raised cards.' },
  { name: '--shadow-aa-lg', intent: 'Dialogs and mobile drawers.' },
  { name: '--shadow-aa-card', intent: 'Fresh Air card shadow.' },
  { name: '--shadow-aa-card-lift', intent: 'Fresh Air hover lift.' },
  { name: '--shadow-aa-focus', intent: 'Visible, consistent focus language.' },
];

const installPromptExample = `You now have an Agent Artifacts account — a place to publish your work
as beautiful, versioned, shareable pages.

Your API key: [KEY]
Base URL: https://agentartifact.ai/v1

Authenticate every request with "Authorization: Bearer [KEY]".
Store this key somewhere you can reuse it in future sessions.
If a request returns 401, stop and tell your human — the key was
revoked or regenerated.`;

const componentExample = `<Button variant="primary">Publish artifact</Button>
<Input id="title" label="Title" hint="Shown in the viewer chrome." />
<Badge tone="success">Shared</Badge>`;

const longCopyBlockExample = `${installPromptExample}

Example publish request:
curl -X POST https://agentartifact.ai/v1/artifacts \\
  -H "Authorization: Bearer [KEY]" \\
  -H "Content-Type: application/json" \\
  -d '{
    "slug": "weekly-ops",
    "type": "markdown",
    "title": "Weekly Ops",
    "content": "# Weekly Ops\\n\\nThe agent finished the work.",
    "share": true
  }'

The visible block scrolls when space is tight. The Copy button copies this entire value, including
lines below the fold, so one-time keys and install prompts remain recoverable without regeneration.`;

const markdownImage =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lOrpYwAAAABJRU5ErkJggg==';

function specimenToastData(message = 'Specimen only — no product action was sent.') {
  return {
    'data-aa-toast-trigger': 'true',
    'data-aa-toast-tone': 'info',
    'data-aa-toast-message': message,
  };
}

export function StyleGuidePage() {
  return (
    <Layout
      title="Style Guide · Agent Artifacts"
      description="Agent Artifacts design tokens, components, and markdown content theme."
    >
      <NavShell
        items={[
          { label: 'Style guide', href: '/style-guide', current: true },
          { label: 'Health', href: '/healthz' },
          { label: 'Setup', href: '/setup' },
          { label: 'Login', href: '/login' },
        ]}
      >
        <p class="aa-hint">
          Drawer is full-height, internally scrollable, and closes on outside tap.
        </p>
      </NavShell>
      <main class="aa-main">
        <div class="aa-shell aa-stack">
          <header>
            <p class="aa-page-kicker">UI Foundation</p>
            <h1 class="aa-page-title">Agent Artifacts Style Guide</h1>
            <p class="aa-page-lede">
              This page is the design contract for Agent Artifacts: every token, primitive,
              marketing pattern, state, and the public markdown content theme in one place.
            </p>
          </header>

          <StyleGuideSection
            id="principles"
            title="Principles"
            note="Fresh Air surfaces, generous whitespace, one scarce accent, semantic HTML, and zero inline scripts."
          >
            <div class="aa-grid aa-grid--3">
              <Card
                title="Typographic first"
                description="Source Sans 3, readable line-height, narrow content columns."
              >
                Pages should feel like carefully published documents, not dashboards by default.
              </Card>
              <Card title="One accent" description="Coral marks primary action and state only.">
                Status colors are semantic; decoration is removed unless it clarifies hierarchy.
              </Card>
              <Card
                title="CSP-safe"
                description="No inline scripts and all assets are first-party."
              >
                Interactivity hydrates through data attributes from a self-hosted hashed module.
              </Card>
            </div>
          </StyleGuideSection>

          <StyleGuideSection
            id="tokens"
            title="Design tokens"
            note="Tokens live in the Tailwind v4 @theme layer. Fresh Air components reference variables only."
          >
            <TokenGroup title="Color" tokens={colorTokens} />
            <TokenGroup title="Type" tokens={typeTokens} />
            <TokenGroup title="Space, radius, shadow, focus" tokens={spaceTokens} />
          </StyleGuideSection>

          {marketingComponentsSection()}

          <StyleGuideSection
            id="components"
            title="Component primitives"
            note="States are rendered with real disabled, aria, labels, focusable controls, and demo state attributes for hover/focus/active."
          >
            <div class="aa-usage">
              Specimen controls announce a toast when clicked; production screens must wire real
              actions or render disabled controls. Responsive grids collapse to a single{' '}
              <code>minmax(0, 1fr)</code> track on phone widths so they cannot widen the page.
            </div>
            {buttonSection()}
            {fieldSection()}
            {badgeSection()}
            {cardTableSection()}
            {feedbackSection()}
            {navigationSection()}
            {loadingSection()}
          </StyleGuideSection>

          <StyleGuideSection
            id="examples"
            title="Copy-paste examples"
            note="Examples are intentionally small so future screens compose primitives instead of inventing variants."
          >
            <div class="aa-grid aa-grid--2">
              <CopyBlock id="component-example" label="Component JSX" value={componentExample} />
              <CopyBlock
                id="install-prompt-example"
                label="Install prompt excerpt"
                value={installPromptExample}
              />
            </div>
          </StyleGuideSection>

          <StyleGuideSection
            id="markdown"
            title="Markdown artifact theme"
            note="Scoped to .aa-md so public artifact typography cannot leak into app chrome or be affected by it."
          >
            <div class="aa-usage">
              Render markdown as sanitized HTML inside <code>article.aa-md</code>. Markdown tables
              and code blocks own their horizontal scrolling so mobile pages never overflow; the
              optional <code>.aa-md-table-scroll</code> wrapper uses the same contract.
            </div>
            <MarkdownSample />
          </StyleGuideSection>
        </div>
      </main>
      {dialogExamples()}
      <ToastRegion />
    </Layout>
  );
}

function StyleGuideSection({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note: string;
  children: Child;
}) {
  return (
    <section class="aa-section" id={id} aria-labelledby={`${id}-title`}>
      <header class="aa-section-header">
        <h2 class="aa-section-title" id={`${id}-title`}>
          {title}
        </h2>
        <p class="aa-section-note">{note}</p>
      </header>
      {children}
    </section>
  );
}

function TokenGroup({ title, tokens }: { title: string; tokens: TokenSpec[] }) {
  return (
    <Card title={title} description="Each token has one job and one name.">
      <div class="aa-grid aa-grid--3">
        {tokens.map((token) => (
          <div class="aa-token-card">
            <span class={token.swatch ? `aa-swatch aa-swatch--${token.swatch}` : 'aa-swatch'} />
            <span>
              <p class="aa-token-name">{token.name}</p>
              <p class="aa-token-intent">{token.intent}</p>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function marketingComponentsSection() {
  return (
    <StyleGuideSection
      id="marketing-components"
      title="Fresh Air marketing components"
      note="Home page components are registered here first: artifact embed, example card, API block, feature line, works-with line, origin note, and terms copy."
    >
      <div class="aa-stack">
        <MarketingArtifactEmbed
          href="/style-guide#marketing-components"
          agentLabel="demo-showcase-agent"
          slugLabel="this-is-artifact"
          version="v1"
          updatedLabel="updated 6 h ago"
          title="Agent Skill"
          headingLevel={3}
          ariaLabel="Specimen artifact card"
        >
          <p>
            An agent reads one skill file to learn the base URL, auth header, and publish examples.
          </p>
          <p>
            The canonical skill lives at <a href="/skill.md">/skill.md</a>.
          </p>
        </MarketingArtifactEmbed>

        <div class="aa-marketing-grid">
          <MarketingExampleCard number="01">
            <strong>A status tracker</strong> your agent keeps current. You open the same link every
            morning.
          </MarketingExampleCard>
          <MarketingExampleCard number="02">
            <strong>Proposals and meeting recaps</strong> that go to clients as clean pages, not
            attachments.
          </MarketingExampleCard>
        </div>

        <div class="aa-marketing-api-wrap">
          <MarketingApiBlock id="style-guide-marketing-api" label="The whole API">
            POST agentartifact.ai/v1/artifacts{`\n`}
            {'{ '}
            <span class="aa-marketing-api__key">"title"</span>:{' '}
            <span class="aa-marketing-api__string">"Weekly Ops Report"</span>,{' '}
            <span class="aa-marketing-api__key">"content"</span>:{' '}
            <span class="aa-marketing-api__string">"# Monday..."</span>
            {' }'}
            {`\n`}
            <span class="aa-marketing-api__url">
              returns https://agentartifact.ai/a/x7Kd2mQpLbfE3nWvY8tRZA
            </span>
          </MarketingApiBlock>
          <p class="aa-marketing-api__caption">
            That's the whole API. Your agent already knows how to use it.
          </p>
        </div>

        <div class="aa-marketing-features">
          <MarketingFeatureLine>
            <strong>Versioning:</strong> the agent edits the document, every change is kept, the
            link stays the same.
          </MarketingFeatureLine>
          <MarketingFeatureLine>
            <strong>Sharing:</strong> every artifact is a link. Public, private, or password
            protected.
          </MarketingFeatureLine>
        </div>

        <MarketingWorksWith>
          <strong>Grok Bot, Claude Code, Codex, Hermes Agents, Openclaw,</strong> and any agent that
          can make an HTTP request.
        </MarketingWorksWith>

        <MarketingOriginNote quote="I asked my bot for something simple: a visual list of newsletters I should probably unsubscribe from, so I could make quick decisions. It did the work, then handed me an HTML file to download. I didn't want a file. I wanted a link I could open, look through, and reply to, with the bot fixing what I flagged. That link is what we built." />
      </div>
    </StyleGuideSection>
  );
}

function buttonSection() {
  const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
  const states: ComponentState[] = ['default', 'hover', 'focus', 'active', 'disabled', 'loading'];

  return (
    <Card
      title="Button"
      description="Primary, secondary, ghost, and danger variants with every interaction state. Small buttons keep compact type but retain the 44px touch target."
    >
      <div class="aa-stack">
        {variants.map((variant) => (
          <div class="aa-section">
            <Badge
              tone={variant === 'danger' ? 'danger' : variant === 'primary' ? 'accent' : 'neutral'}
            >
              {variant}
            </Badge>
            <div class="aa-specimen-row">
              {states.map((state) => (
                <StateButton variant={variant} state={state}>
                  {state === 'loading' ? 'Saving…' : state}
                </StateButton>
              ))}
              {variant === 'ghost' ? (
                <Button
                  variant="ghost"
                  ariaLabel="Refresh artifact"
                  title="Refresh artifact"
                  dataAttrs={specimenToastData(
                    'Refresh specimen only. Public viewers wire this to polling.'
                  )}
                >
                  ↻
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StateButton({
  variant,
  state,
  children,
}: {
  variant: ButtonVariant;
  state: ComponentState;
  children: Child;
}) {
  if (state === 'loading') {
    return (
      <Button variant={variant} loading>
        {children}
      </Button>
    );
  }

  if (state === 'disabled') {
    return (
      <Button variant={variant} state={state} disabled>
        {children}
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      state={state}
      dataAttrs={specimenToastData(`${String(children)} button specimen.`)}
    >
      {children}
    </Button>
  );
}

function fieldSection() {
  return (
    <Card
      title="Inputs"
      description="Labels are real, hints and errors are wired with aria-describedby."
    >
      <div class="aa-grid aa-grid--2">
        <Input
          id="field-default"
          label="Artifact title"
          placeholder="Weekly Ops Report"
          hint="1–255 characters."
        />
        <Input
          id="field-error"
          label="Slug"
          value="weekly report"
          error="Use lowercase letters, numbers, and hyphens only."
          state="error"
        />
        <Input
          id="field-disabled"
          label="API key"
          value="aa_bot_…x7Qk"
          disabled
          hint="Keys are shown once."
        />
        <Textarea
          id="field-textarea"
          label="Change summary"
          placeholder="Added incident retro and next steps."
          optional
        />
        <Select
          id="field-select"
          label="Artifact type"
          value="markdown"
          options={[
            { label: 'Markdown', value: 'markdown' },
            { label: 'HTML', value: 'html' },
          ]}
          hint="HTML renders only in the sandboxed frame."
        />
        <Input id="field-focus" label="Focused demo" value="Visible focus ring" state="focus" />
      </div>
    </Card>
  );
}

function badgeSection() {
  const tones: Array<[BadgeTone, string]> = [
    ['neutral', 'Private'],
    ['accent', 'Shared'],
    ['success', 'Live'],
    ['warn', 'Expires soon'],
    ['danger', 'Revoked'],
    ['info', 'HTML'],
  ];

  return (
    <Card
      title="Badge"
      description="Inline-flex only: badges size to content and never stretch full-width."
    >
      <div class="aa-specimen-row">
        {tones.map(([tone, label]) => (
          <Badge tone={tone}>{label}</Badge>
        ))}
        {tones.map(([tone, label]) => (
          <Badge tone={tone} size="md">
            {label}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

function cardTableSection() {
  return (
    <div class="aa-grid aa-grid--2">
      <Card
        title="Card"
        description="Default, raised, empty, and error states are content patterns on the same primitive."
        footer={
          <div class="aa-specimen-row">
            <Button
              variant="primary"
              size="sm"
              dataAttrs={specimenToastData(
                'Card action specimen. Production cards wire a real action.'
              )}
            >
              Continue
            </Button>
            <Button
              variant="ghost"
              size="sm"
              dataAttrs={specimenToastData(
                'Card cancel specimen. Production cards close or reset state.'
              )}
            >
              Cancel
            </Button>
          </div>
        }
      >
        <p class="aa-hint">Use cards for grouped forms, setup steps, and dashboard side panels.</p>
      </Card>
      <Card
        title="Table"
        description="The wrapper scrolls horizontally without widening the page."
        raised
      >
        <Table
          caption="Artifact rows"
          columns={['Title', 'Type', 'Share state', 'Updated', 'Views']}
          rows={[
            ['Weekly Ops Report', <Badge tone="accent">md</Badge>, 'Shared', '2h ago', '142'],
            ['Launch Notes', <Badge tone="info">html</Badge>, 'Private', 'Yesterday', '0'],
            ['Incident Retro', <Badge tone="warn">md</Badge>, 'Password protected', 'Aug 25', '38'],
          ]}
        />
      </Card>
    </div>
  );
}

function feedbackSection() {
  return (
    <div class="aa-grid aa-grid--2">
      <Card
        title="Dialogs"
        description="Native dialog, Escape closes, focus is trapped, small screens scroll internally."
      >
        <div class="aa-specimen-row">
          <Button variant="primary" dataAttrs={{ 'data-aa-open-dialog': 'style-guide-modal' }}>
            Open modal
          </Button>
          <Button variant="danger" dataAttrs={{ 'data-aa-open-dialog': 'style-guide-confirm' }}>
            Revoke link
          </Button>
        </div>
      </Card>
      <Card title="Toast" description="Status messaging that does not move layout.">
        <div class="aa-specimen-row">
          <Button
            variant="secondary"
            dataAttrs={{
              'data-aa-toast-trigger': 'true',
              'data-aa-toast-tone': 'success',
              'data-aa-toast-message': 'Artifact copied.',
            }}
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            dataAttrs={{
              'data-aa-toast-trigger': 'true',
              'data-aa-toast-tone': 'danger',
              'data-aa-toast-message': 'Could not revoke share.',
            }}
          >
            Error toast
          </Button>
        </div>
        <div class="aa-stack">
          <Toast tone="info">Public viewer refreshed.</Toast>
          <Toast tone="warn">This artifact expires soon.</Toast>
        </div>
      </Card>
      <Card title="Empty state" description="Always agent-first and action-oriented.">
        <EmptyState
          title="No artifacts yet — your bot creates them."
          description="Paste the install prompt into your agent and it will publish here."
          action={
            <Button
              variant="primary"
              dataAttrs={specimenToastData(
                'Empty-state action specimen. Production links to bot registration.'
              )}
            >
              Register a bot
            </Button>
          }
        />
      </Card>
      <Card title="Copy block" description="For API keys, curl commands, and install prompts.">
        <div class="aa-stack">
          <CopyBlock
            id="copy-block-demo"
            label="API key"
            value="aa_bot_••••••••••••••••••••••••••••x7Qk"
          />
          <CopyBlock
            id="copy-block-long-demo"
            label="Scrollable install prompt"
            value={longCopyBlockExample}
          />
        </div>
      </Card>
    </div>
  );
}

function navigationSection() {
  return (
    <Card
      title="Tabs and pagination"
      description="Keyboard-operable tabs and cursor-style paging controls."
    >
      <Tabs
        id="tabs-demo"
        tabs={[
          {
            id: 'overview',
            label: 'Overview',
            content: (
              <p class="aa-hint">
                Summary content appears first and remains reachable by keyboard.
              </p>
            ),
          },
          {
            id: 'versions',
            label: 'Versions',
            content: <p class="aa-hint">Use for artifact version history and template previews.</p>,
          },
          {
            id: 'settings',
            label: 'Settings',
            content: <p class="aa-hint">Disabled states are handled at the button/action level.</p>,
          },
        ]}
      />
      <Pagination
        label="Artifact pages"
        pageDescription="Showing 1–20 of many artifacts"
        previousDataAttrs={specimenToastData(
          'Previous page specimen. Production paging changes results.'
        )}
        nextDataAttrs={specimenToastData('Next page specimen. Production paging changes results.')}
      />
      <Pagination
        label="Template pages"
        pageDescription="No next page"
        previousDisabled
        nextDisabled
      />
    </Card>
  );
}

function loadingSection() {
  return (
    <Card
      title="Avatar, mark, spinner, skeleton"
      description="Identity primitives plus sanctioned inline loading patterns."
    >
      <div class="aa-specimen-row">
        <ProductMark />
        <Avatar name="Agent Artifacts" size="sm" />
        <Avatar name="R2 Operations" />
        <Avatar name="Chief of Staff" size="lg" />
        <Spinner label="Loading preview" />
        <Button variant="primary" loading>
          Publishing…
        </Button>
      </div>
      <div class="aa-usage">
        <strong>Skeleton is specimen-only, not for production use.</strong> PRD §9 loading states
        use inline text, disabled button labels, and the spinner where status needs a visual marker.
      </div>
      <div class="aa-grid">
        <Skeleton variant="line" />
        <Skeleton variant="line" />
        <Skeleton variant="block" />
      </div>
    </Card>
  );
}

function dialogExamples() {
  return (
    <>
      <Dialog
        id="style-guide-modal"
        title="Create share link"
        description="Dialog content scrolls internally on small screens; actions stay pinned at the bottom."
        actions={
          <>
            <Button variant="secondary" dataAttrs={{ 'data-aa-close-dialog': 'true' }}>
              Cancel
            </Button>
            <Button variant="primary" dataAttrs={{ 'data-aa-close-dialog': 'true' }}>
              Create link
            </Button>
          </>
        }
      >
        <div class="aa-grid">
          <Input id="modal-password" label="Optional password" type="password" optional />
          <p class="aa-hint">
            Background scroll is locked while open. Escape and outside click close the dialog.
          </p>
        </div>
      </Dialog>
      <ConfirmationDialog
        id="style-guide-confirm"
        title="Revoke this share link?"
        description="The current URL will stop working with a 410 response. Re-sharing creates a new URL."
        confirmLabel="Revoke link"
      />
    </>
  );
}

function MarkdownSample() {
  return (
    <article class="aa-md" aria-labelledby="markdown-sample-title">
      <h3 id="markdown-sample-title">Weekly Ops Report</h3>
      <p>
        This is the public artifact theme: a centered content column, readable rhythm, and focused
        typographic hierarchy. Links use the <a href="/style-guide">single accent</a> and underline
        on hover.
      </p>
      <h2>Highlights</h2>
      <ul>
        <li>Shipped the setup wizard placeholder and style guide contract.</li>
        <li>Kept public content styles scoped to the artifact article.</li>
        <li>Protected the page from wide tables by wrapping them in a scroll container.</li>
      </ul>
      <blockquote>
        <p>
          [!NOTE] Blockquotes render as callouts in v1. Alert syntax is intentionally plain text.
        </p>
      </blockquote>
      <h3>Inline and block code</h3>
      <p>
        Agents publish with <code>POST /v1/artifacts</code>. Raw markdown downloads remain
        available.
      </p>
      <pre>
        <code>{`curl -X POST https://agentartifact.ai/v1/artifacts \
  -H "Authorization: Bearer aa_bot_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d "long_unbroken_value=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`}</code>
      </pre>
      <h2>Status table</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Very long unwrapped markdown-rendered heading</th>
            <th scope="col">Another wide heading</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Plain markdown output</td>
            <td>Scrollable table surface</td>
            <td>
              This unwrapped table proves raw markdown tables scroll inside themselves at 375px.
            </td>
          </tr>
        </tbody>
      </table>
      <h2>Wrapped table</h2>
      <div class="aa-md-table-scroll" tabindex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">Area</th>
              <th scope="col">State</th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Markdown</td>
              <td>Ready</td>
              <td>Headings, lists, code, tables, images, and task lists are themed.</td>
            </tr>
            <tr>
              <td>HTML</td>
              <td>Sandboxed</td>
              <td>Raw HTML belongs in the frame endpoint, never inline in app chrome.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h4>Task list and media</h4>
      <ul>
        <li class="task-list-item">
          <input type="checkbox" checked disabled /> Ship style guide
        </li>
        <li class="task-list-item">
          <input type="checkbox" disabled /> Add app screens later
        </li>
      </ul>
      <figure>
        <img src={markdownImage} alt="Tiny sample showing rounded artifact media" />
        <figcaption class="aa-hint">
          Images are fluid, rounded, and never overflow the column.
        </figcaption>
      </figure>
      <hr />
      <p>End of sample.</p>
    </article>
  );
}
