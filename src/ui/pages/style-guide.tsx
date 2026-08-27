import type { Child } from 'hono/jsx';
import { Layout } from '../components/layout.js';
import {
  MarketingApiBlock,
  MarketingArtifactEmbed,
  MarketingExampleCard,
  MarketingFeatureLine,
  MarketingFinalCta,
  MarketingOriginNote,
  MarketingWorksWith,
} from '../components/marketing.js';
import {
  Avatar,
  Badge,
  type BadgeTone,
  Button,
  ButtonRow,
  type ButtonVariant,
  Card,
  type ComponentState,
  ConfirmationDialog,
  ConfirmDestructive,
  CopyBlock,
  Dialog,
  EmptyState,
  Input,
  NavShell,
  Notice,
  Pagination,
  ProductMark,
  Select,
  Skeleton,
  Spinner,
  StatusHeading,
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

const widthTokens: TokenSpec[] = [
  {
    name: '--width-aa-shell',
    intent: 'The app shell: dashboard, style guide, every signed-in page.',
  },
  { name: '--width-aa-shell-marketing', intent: 'The marketing shell on the home page.' },
  {
    name: '--width-aa-panel',
    intent: 'Feature panels: the hero artifact card and the terms card.',
  },
  {
    name: '--width-aa-shell-narrow',
    intent: 'Auth, setup, verify and placeholder: the single card that is the whole page.',
  },
  {
    name: '--width-aa-measure',
    intent: 'The marketing reading column: the API block, the feature lines, the origin note.',
  },
  { name: '--width-aa-dialog', intent: 'Modal dialogs, capped against the viewport.' },
  { name: '--width-aa-drawer', intent: 'Mobile drawer panel; the scrim owns every other pixel.' },
  { name: '--width-aa-toast', intent: 'Toast region, capped against the viewport.' },
  { name: '--width-aa-prose', intent: 'The artifact reading column: 72ch, type-relative.' },
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
  {
    name: '--color-aa-focus',
    intent:
      'The focus ring colour. Defaults to the accent; a toned surface sets it locally so the ring belongs to what it lands on.',
  },
  {
    name: '--shadow-aa-focus',
    intent: 'The focus halo, derived from --color-aa-focus so ring and glow always agree.',
  },
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
              <Card
                title="Where CSS lives"
                description="One stylesheet, and a rule for what is allowed into it."
              >
                <code>app.css</code> holds what a component owns and this page documents. Writing
                CSS for a single page means a component is missing: build the component, register it
                here, and its CSS follows. The one exception is a page's own layout scaffolding,
                named <code>.aa-&lt;page&gt;-*</code> — which must graduate to a component the
                moment a second page wants it.
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
            <TokenGroup title="Width" tokens={widthTokens} />
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
            {widthSection()}
            {fieldSection()}
            {passwordFieldSection()}
            {badgeSection()}
            {noticeSection()}
            {destructiveSection()}
            {cardTableSection()}
            {listRowSection()}
            {dangerCardSection()}
            {feedbackSection()}
            {navigationSection()}
            {loadingSection()}
          </StyleGuideSection>

          <StyleGuideSection
            id="documents"
            title="Document surfaces"
            note="Four surfaces replace the whole page rather than composing into one, so they are described here instead of specimened. Every one of them exists because a real screen was shipping raw bytes to a human."
          >
            <div class="aa-grid aa-grid--2">
              <Card
                title="FrameDocument"
                description="src/ui/pages/frame-document.ts — the shell around a sandboxed HTML artifact."
              >
                <p class="aa-hint">
                  Agent HTML is served from the sandbox origin, which cannot load this stylesheet,
                  so the shell is self-contained: one inline <code>&lt;style&gt;</code>, no{' '}
                  <code>&lt;link&gt;</code>, no font file and no request. Every baseline rule is a
                  bare element selector so anything the agent writes outranks it, and content that
                  already declares its own <code>&lt;!doctype&gt;</code> passes through byte for
                  byte. It wraps; it never rewrites.
                </p>
                <p class="aa-hint">
                  The one script it adds is the height sender, appended to wrapped fragments so the
                  viewer can size the frame to its content instead of the 432px fallback. It posts a
                  single <code>aa:frame-height</code> message and does nothing else.
                </p>
                <p class="aa-hint">
                  <strong>Accepted limit:</strong> an artifact that ships a whole document is passed
                  through untouched, so it receives no sender and keeps the fixed 432px frame. Byte
                  fidelity for author-written documents is worth more than automatic height, and the
                  two cannot both be had.
                </p>
              </Card>
              <Card
                title="FrameTerminalDocument"
                description="The sandbox origin's own missing / gone / locked page."
              >
                <p class="aa-hint">
                  Same self-contained rules, the product mark, one sentence of explanation and one
                  action. Distinct copy per cause — missing, no longer available, password-protected
                  — because one string for three states tells at least two lies.
                </p>
              </Card>
              <Card
                title="ErrorPage"
                description="src/ui/pages/error-page.tsx — what a browser gets when a request misses."
              >
                <p class="aa-hint">
                  Chosen by content negotiation in the global handler: an <code>Accept</code> that
                  asks for HTML gets this page, everything else keeps the JSON envelope, and{' '}
                  <code>/v1</code> keeps it unconditionally. Chrome follows the visitor — a
                  signed-in owner keeps their dashboard navigation, everyone else gets the public
                  card.
                </p>
              </Card>
              <Card
                title="VersionBanner"
                description="src/ui/components/version-banner.tsx — shown only when a version is pinned."
              >
                <p class="aa-hint">
                  <code>isPinnedVersion(shown, latest)</code> is the whole decision, and{' '}
                  <code>viewer-*.js</code> calls a predicate of the same name with the same body. On
                  the latest version both the banner and its "View latest" link are hidden, because
                  a link to the page you are already on is not a link.
                </p>
              </Card>
            </div>
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
      note="Home page components are registered here first: artifact embed, example card, API block, feature line, works-with line, origin note, terms copy, and the closing call to action."
    >
      <div class="aa-stack">
        <MarketingArtifactEmbed
          href="/style-guide#marketing-components"
          agentLabel="demo-showcase-agent"
          slugLabel="this-is-artifact"
          version="v3"
          // A shape, not a value. "updated 6 h ago" was the hard-coded string W5 removed from the
          // home page for being a lie, and a design contract that keeps showing it teaches the
          // pattern that produced it — the next person copies the specimen, not the fix.
          updatedLabel="updated {relative time}"
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

        <MarketingArtifactEmbed
          href="/style-guide#marketing-components"
          agentLabel="demo-showcase-agent"
          slugLabel="this-is-artifact"
          title="Agent Skill without live meta"
          headingLevel={3}
          ariaLabel="Specimen artifact card with unknown live state"
        >
          <p>
            Version and updated time are omitted whenever the live artifact state is unknown. The
            strip never shows a time it cannot prove.
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

        <MarketingFinalCta
          href="/login?mode=magic"
          label="Get your key"
          note="Hashed URL · free · no card"
        />

        <MarketingFinalCta href="/dashboard" label="Open your dashboard" />
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
            <ButtonRow>
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
            </ButtonRow>
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

function widthSection() {
  return (
    <Card
      title="Width and action rows"
      description="Width is a property of the component, never of the parent it happens to land in. Action rows are one primitive, at every viewport."
    >
      <div class="aa-usage">
        A <code>Button</code> is intrinsically sized. Pass <code>fullWidth</code> where the design
        calls for a full-bleed action — never rely on a grid parent to stretch it. Group actions in{' '}
        <code>ButtonRow</code>, which wraps at 375 and keeps the 44px touch target on every line.
        Container widths come from the <code>--width-aa-*</code> scale above; a raw rem literal in a
        container width is a bug.
      </div>
      <div class="aa-section">
        <Badge>intrinsic width, four alignments</Badge>
        <ButtonRow>
          <Button variant="primary" dataAttrs={specimenToastData('ButtonRow start specimen.')}>
            Publish artifact
          </Button>
          <Button variant="secondary" dataAttrs={specimenToastData('ButtonRow start specimen.')}>
            Save draft
          </Button>
          <Button variant="ghost" dataAttrs={specimenToastData('ButtonRow start specimen.')}>
            Cancel
          </Button>
        </ButtonRow>
        <ButtonRow align="center">
          <Button variant="secondary" dataAttrs={specimenToastData('ButtonRow center specimen.')}>
            Centred
          </Button>
          <Button variant="ghost" dataAttrs={specimenToastData('ButtonRow center specimen.')}>
            Go home
          </Button>
        </ButtonRow>
        <ButtonRow align="end">
          <Button variant="ghost" dataAttrs={specimenToastData('ButtonRow end specimen.')}>
            Cancel
          </Button>
          <Button variant="primary" dataAttrs={specimenToastData('ButtonRow end specimen.')}>
            Confirm
          </Button>
        </ButtonRow>
        <ButtonRow align="between">
          <Button variant="ghost" dataAttrs={specimenToastData('ButtonRow between specimen.')}>
            Back
          </Button>
          <Button variant="primary" dataAttrs={specimenToastData('ButtonRow between specimen.')}>
            Next
          </Button>
        </ButtonRow>
      </div>
      <div class="aa-section">
        <Badge>fullWidth</Badge>
        <Button
          variant="primary"
          fullWidth
          dataAttrs={specimenToastData('Full-width button specimen.')}
        >
          View artifact
        </Button>
      </div>
    </Card>
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

function passwordFieldSection() {
  return (
    <Card
      title="Password fields"
      description="Boxes that look identical and mean different things. autocomplete is what tells them apart."
    >
      <div class="aa-grid">
        <Input
          id="field-current-password"
          label="Current password"
          type="password"
          autocomplete="current-password"
        />
        <Input
          id="field-new-password"
          label="New password"
          type="password"
          autocomplete="new-password"
          hint="At least 12 characters."
        />
        <Input
          id="field-confirm-password"
          label="Confirm new password"
          type="password"
          autocomplete="new-password"
        />
      </div>
      <p class="aa-hint">
        Three password boxes on one form are indistinguishable to a password manager unless the
        markup says which is which. Without <code>autocomplete</code> it offers to fill all three
        with the current password, and to save the wrong one afterwards — so the field that decides
        whether someone can still log in is set by a guess. <code>current-password</code> and{' '}
        <code>new-password</code> are the browser's vocabulary, not ours; the value is not styling
        and not a hint, so it belongs on every password field the product ships rather than only on
        the forms where a manager has been seen getting it wrong.
      </p>
      <p class="aa-hint">
        A password-typed box that is not a password wants saying so too: a one-time setup token
        rendered with <code>type="password"</code> will be offered for saving as the site password
        unless it opts out.
      </p>
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
      <ButtonRow>
        {tones.map(([tone, label]) => (
          <Badge tone={tone}>{label}</Badge>
        ))}
        {tones.map(([tone, label]) => (
          <Badge tone={tone} size="md">
            {label}
          </Badge>
        ))}
      </ButtonRow>
    </Card>
  );
}

function listRowSection() {
  const rows: Array<[string, string, BadgeTone, string]> = [
    ['default', 'Weekly Ops Report', 'success', 'v3'],
    ['hover', 'Q3 revenue breakdown', 'accent', 'v11'],
    ['focus', 'Customer interview notes', 'neutral', 'v1'],
  ];

  return (
    <Card
      title="List row"
      description="The row pattern for every list of artifacts: aligned columns, one target, accent spent only on the row being pointed at."
    >
      <div class="aa-list">
        {rows.map(([state, title, tone, version]) => (
          <div class="aa-list-row" data-aa-state={state === 'default' ? undefined : state}>
            <span class="aa-list-row__title">
              <a class="aa-list-row__link" href="/style-guide#components">
                {title}
              </a>
            </span>
            <Badge tone={tone}>Shared</Badge>
            <span class="aa-list-row__meta">
              {version} · updated {'{relative}'}
            </span>
          </div>
        ))}
      </div>
      <p class="aa-hint">
        <code>.aa-list</code> owns the columns and each <code>.aa-list-row</code> borrows them with{' '}
        <code>subgrid</code>, so badge and meta line up down the whole list instead of every row
        sizing itself. Below 480px they stop sharing a line — the title takes its own and the badge
        and meta sit under it, because three columns on a phone leave the title about forty pixels
        and alignment buys nothing when only one row is being read. Titles are ink: a list where
        every title is coloured has no emphasis left for the one under the cursor, so accent is
        spent on hover and focus only. The whole row is the click target via a stretched link, and
        the row — not the invisible overlay — is what shows the focus ring.
      </p>
    </Card>
  );
}

function dangerCardSection() {
  return (
    <Card
      title="Card · danger tone"
      description="For a card whose subject is destructive. Border reddens, header tints, body stays neutral."
    >
      <Card
        tone="danger"
        title="Delete this artifact"
        description="This removes every version and breaks any link already shared."
      >
        <ButtonRow>
          <Button variant="danger" {...specimenToastData('Specimen only — nothing was deleted.')}>
            Delete artifact
          </Button>
          <Button variant="ghost" {...specimenToastData()}>
            Cancel
          </Button>
        </ButtonRow>
      </Card>
      <p class="aa-hint">
        The tint stops at the header. Tinting the body would make the card's contents read as the
        warning, when the contents are usually the thing being protected.
      </p>
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
          <ButtonRow>
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
          </ButtonRow>
        }
      >
        <p class="aa-hint">Use cards for grouped forms, setup steps, and dashboard side panels.</p>
      </Card>
      <Card
        title="Table"
        description="Scrolls horizontally without widening the page, and says so — but only when there is something past the edge."
        raised
      >
        <Table
          id="style-guide-artifact-rows"
          caption="Artifact rows"
          columns={['Title', 'Type', 'Share state', 'Updated', 'Views']}
          rows={[
            ['Weekly Ops Report', <Badge tone="accent">md</Badge>, 'Shared', '{relative}', '142'],
            ['Launch Notes', <Badge tone="info">html</Badge>, 'Private', 'Yesterday', '0'],
            ['Incident Retro', <Badge tone="warn">md</Badge>, 'Password protected', 'Aug 25', '38'],
          ]}
        />
        <div class="aa-usage">
          The region is focusable, named from its caption, and carries an inline-end fade plus a
          hint whenever <code>scrollWidth &gt; clientWidth</code> — measured, never assumed, and
          re-measured on resize. A table that fits shows neither.
        </div>
      </Card>
      {tableColumnPrioritySection()}
    </div>
  );
}

function tableColumnPrioritySection() {
  return (
    <Card
      title="Table column priority"
      description="The documented way to survive 375px when scrolling to a column is the wrong answer."
    >
      <div class="aa-usage">
        Default behaviour is to keep every column and scroll. Where a column is genuinely supporting
        detail, mark it <code>{"{ label: 'Last used', priority: 'secondary' }"}</code> and pass{' '}
        <code>columnPriority</code>: below 480px those columns are dropped and the table stops
        forcing its <code>min-width</code>, so what remains fits the phone instead of hiding behind
        a scroll the reader has to discover. Never mark an Actions column secondary — a control the
        reader cannot reach is worse than a cramped one.
      </div>
      <Table
        id="style-guide-priority-rows"
        caption="Registered bots"
        columnPriority
        columns={[
          'Name',
          { label: 'Key', priority: 'secondary' },
          { label: 'Last used', priority: 'secondary' },
          'Actions',
        ]}
        rows={[
          [
            'ops-bot',
            <code>aa_bot_…x7Qk</code>,
            '{relative}',
            <ButtonRow>
              <Button
                variant="danger"
                size="sm"
                dataAttrs={specimenToastData('Row action specimen.')}
              >
                Revoke
              </Button>
            </ButtonRow>,
          ],
          [
            'retro-bot',
            <code>aa_bot_…m2Pd</code>,
            'Yesterday',
            <ButtonRow>
              <Button
                variant="danger"
                size="sm"
                dataAttrs={specimenToastData('Row action specimen.')}
              >
                Revoke
              </Button>
            </ButtonRow>,
          ],
        ]}
      />
    </Card>
  );
}

function destructiveSection() {
  return (
    <Card
      title="Destructive confirmation"
      description="The canonical shape for anything that cannot be taken back: trigger, then dialog, then a typed confirmation inside the dialog."
    >
      <div class="aa-usage">
        At rest a destructive action is <strong>one button</strong>. The typed confirmation lives
        inside the dialog it opens, never on the page — a screen with eight live destructive inputs
        sitting open has no second step and therefore no confirmation at all. Cancel takes initial
        focus; the confirming button stays inert until the typed value matches exactly; and inside
        the dialog the danger variant is solid, so the most consequential control on screen is not
        also the quietest. The client-side match is a courtesy — the server revalidates the typed
        confirmation, and must keep doing so.
      </div>
      <ButtonRow>
        <ConfirmDestructive
          id="style-guide-revoke"
          triggerLabel="Revoke link"
          title="Revoke this share link?"
          description="The current URL stops working immediately. Re-sharing creates a new URL."
          consequence="This cannot be undone. Anyone holding the old link will see a missing page."
          confirmValue="weekly-ops"
          confirmLabel="Revoke link"
          action="/style-guide#components"
          fields={{ specimen: 'true' }}
        />
        <ConfirmDestructive
          id="style-guide-delete-account"
          triggerLabel="Delete account"
          title="Delete this account permanently?"
          description="Every artifact, share link and bot key belonging to this account is removed."
          consequence="This cannot be undone. Shared links stop working immediately and show as missing."
          confirmValue="you@example.com"
          confirmLabel="Delete account permanently"
          action="/style-guide#components"
          fields={{ specimen: 'true' }}
        />
      </ButtonRow>
      <ConfirmationDialog
        id="style-guide-confirm-simple"
        title="Restore this version?"
        description="Restoring rewrites the current content with the contents of this version."
        confirmLabel="Restore version"
      />
      <div class="aa-usage">
        Where there is nothing to type — a reversible action that still deserves a beat, like
        restoring a version — use <code>ConfirmationDialog</code> instead. Reach for a typed
        confirmation only when the action is irreversible.
      </div>
      <ButtonRow>
        <Button
          variant="secondary"
          dataAttrs={{ 'data-aa-open-dialog': 'style-guide-confirm-simple' }}
        >
          Restore version
        </Button>
      </ButtonRow>
    </Card>
  );
}

function noticeSection() {
  return (
    <Card
      title="Notice"
      description="Page-level feedback about something that just happened. Four tones, one mark each, optional dismissal, and no layout movement."
    >
      <div class="aa-usage">
        <strong>Where a status goes — in this order. Fall down a rung only when you must.</strong>
        <br />
        <strong>1. In the heading row of the thing it describes.</strong> <code>StatusHeading</code>
        , the generalisation of the viewer's "Updated" pill — the one status in this product that is
        placed correctly, because it sits inside the title row of the object that changed.
        <br />
        <strong>2. On the field that caused it.</strong> <code>Input error</code>, which puts the
        red ring, <code>aria-invalid</code> and <code>aria-describedby</code> on the control itself.
        <br />
        <strong>3. In the card whose action produced it.</strong> <code>Card notice</code>, which
        renders between that panel's header and its body.
        <br />
        <strong>4. At page level.</strong> <code>{'<Notice placement="page" />'}</code>, and only
        when the outcome belongs to the page rather than to anything on it. This rung has a price:
        the notice is focusable and takes focus on load, because a message the reader has to go
        looking for is a message that gets missed.
        <br />
        Measured across the screens: every status except the Updated pill was detached from its
        subject — "Link sent" floating 32px above its own heading, a validation error ~300px above
        the field it names. Prettier components placed the same way are the same defect.
      </div>
      <div class="aa-stack">
        <StatusHeading level={3} status="Link sent" tone="success">
          Check your email
        </StatusHeading>
        <StatusHeading level={3} status="Revoked" tone="danger">
          Weekly Ops Report
        </StatusHeading>
        <Card
          title="Password"
          description="A panel reports its own outcome, beside itself."
          notice={
            <Notice tone="success" title="Password updated.">
              Every other session was signed out.
            </Notice>
          }
        >
          <p class="aa-hint">
            This notice sits between the card's header and its body — not at the top of the page.
          </p>
        </Card>
        <Notice tone="danger" title="That page no longer exists." placement="page">
          A page-level notice: focusable, and focused on load, because nothing on the page owns it.
        </Notice>
      </div>
      <div class="aa-usage">
        Use a <code>Notice</code> for the outcome of an action the page just performed. Use a{' '}
        <code>Badge</code> for the state of an object (the viewer's "Updated" pill is the correct
        badge). Use a <code>Toast</code> only for asynchronous events the user did not just trigger.
        A notice is rendered with the page, so it is present in the first paint and moves nothing;{' '}
        <code>warn</code> and <code>danger</code> announce as <code>alert</code>, <code>info</code>{' '}
        and <code>success</code> as <code>status</code>.
      </div>
      <div class="aa-stack">
        <Notice tone="success" title="Artifact deleted." dismissible>
          The share link stopped working immediately.
        </Notice>
        <Notice tone="info" title="Filters applied.">
          Showing 4 of 20 artifacts. Clear the filters to see everything again.
        </Notice>
        <Notice tone="warn" title="Key regenerated. Old key is invalid now." dismissible>
          Update the agent that was using the previous key before its next run.
        </Notice>
        <Notice tone="danger" title="Typed confirmation did not match.">
          Nothing was deleted. Type the slug exactly as shown to confirm.
        </Notice>
        <Notice tone="info" title="Message only — no title needed." />
        <Notice tone="danger">
          A notice can carry a message with no title when the sentence is the whole story.
        </Notice>
      </div>
    </Card>
  );
}

function feedbackSection() {
  return (
    <div class="aa-grid aa-grid--2">
      <Card
        title="Dialogs"
        description="Native dialog, Escape closes, focus is trapped, small screens scroll internally."
      >
        <ButtonRow>
          <Button variant="primary" dataAttrs={{ 'data-aa-open-dialog': 'style-guide-modal' }}>
            Open modal
          </Button>
          <Button variant="danger" dataAttrs={{ 'data-aa-open-dialog': 'style-guide-confirm' }}>
            Revoke link
          </Button>
        </ButtonRow>
      </Card>
      <Card title="Toast" description="Status messaging that does not move layout.">
        <ButtonRow>
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
        </ButtonRow>
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
      <Pagination
        label="Artifact list pages"
        pageDescription="20 shown so far"
        previousDisabled
        previousHref="/dashboard"
        nextHref="/dashboard?cursor=aa_cur_8Fq2"
      />
      <p class="aa-hint">
        Two ways to drive one component. The first two specimens are script-driven: their steps are
        buttons, for a client that replaces the results in place. The third is the artifact list
        footer, which is where the href props came from — a server-rendered list paging through
        cursor URLs, so its steps have to be links. A link survives a middle-click, a copy, and a
        page load before any JavaScript has run; a button does none of those, which is most of why
        this component sat unused while lists hand-rolled a Button for "there is more" and a Badge
        for "that was all" — two kinds of object for two states of one thing.
      </p>
      <p class="aa-hint">
        The third specimen is also the first page, so its Previous step is disabled while still
        being given an href. A disabled step keeps its element and loses its destination: it renders
        as an anchor carrying <code>aria-disabled="true"</code> and <code>tabindex="-1"</code>, with
        no <code>href</code> at all — rather than a live link that looks unavailable, or a control
        that changes tag between pages and moves the focus order under the reader.
      </p>
    </Card>
  );
}

function loadingSection() {
  return (
    <Card
      title="Avatar, mark, spinner, skeleton"
      description="Identity primitives plus sanctioned inline loading patterns."
    >
      <ButtonRow>
        <ProductMark />
        <Avatar name="Agent Artifacts" size="sm" />
        <Avatar name="R2 Operations" />
        <Avatar name="Chief of Staff" size="lg" />
        <Spinner label="Loading preview" />
        <Button variant="primary" loading>
          Publishing…
        </Button>
      </ButtonRow>
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
          <Input
            id="modal-password"
            label="Optional password"
            type="password"
            optional
            autocomplete="new-password"
          />
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
