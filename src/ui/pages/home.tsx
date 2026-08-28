import {
  HERO_ARTIFACT_PATH,
  heroArtifactUrl,
  type LiveArtifactMeta,
} from '../../services/live-artifact-meta.js';
import { Layout } from '../components/layout.js';
import {
  MarketingApiBlock,
  MarketingExampleCard,
  MarketingFeatureLine,
  MarketingFooter,
  MarketingOriginNote,
  MarketingSection,
  MarketingWorksWith,
} from '../components/marketing.js';
import { Button, ProductMark } from '../components/primitives.js';

export const HOME_HERO = 'Let your agent show its work.';
export const HOME_SUBLINE =
  'Agents can generate custom UI and create clean, versioned pages with a shareable link.';
export const HOME_AGENT_SKILL_COPY =
  'An agent reads one skill file to learn how to publish here: base URL, auth header, create, update, share.';
export const HOME_ORIGIN_QUOTE =
  "I asked my bot for something simple: a visual list of newsletters I should probably unsubscribe from, so I could make quick decisions. It did the work, then handed me an HTML file to download. I didn't want a file. I wanted a link I could open, look through, and reply to, with the bot fixing what I flagged. That link is what we built.";

export const HOME_CTA_LABEL = 'Get started';
export const HOME_HERO_CTA_LABEL = 'Get started';
export const HOME_CTA_HREF = '/login?mode=magic';
export const HOME_CTA_REASSURANCE = 'Hashed URL · free · no card';
export const HOME_AUTHENTICATED_CTA_LABEL = 'Open your dashboard';
/**
 * Canonical repository URL for the hero's "View on GitHub" action. `githubUrl` (set from
 * `AA_GITHUB_URL`) wins when present; this is the fallback so the button is never absent.
 * NOTE: until the repository is published this URL answers 404 — publishing it, or setting
 * AA_GITHUB_URL to the real location, is what makes the link resolve.
 */
export const HOME_REPO_URL = 'https://github.com/ZeroPointRepo/agent-artifacts';

export const HOME_DEMO_ARTIFACTS = [
  {
    title: 'Agent Skill',
    description: 'A real artifact that explains how agents publish here.',
    slugLabel: 'this-is-artifact',
    path: HERO_ARTIFACT_PATH,
  },
] as const;

export const HOME_AGENT_SKILL_ARTIFACT = HOME_DEMO_ARTIFACTS[0];

/**
 * The four things people actually build here. Each carries an `examplePath` — the public
 * share URL of a real artifact that demonstrates the use case. The "See the example" link
 * only renders when the path is set, so a card is never shipped pointing at a page that does
 * not exist (the same discipline the GitHub affordance follows). Seed the artifact, set the
 * path, and the link appears.
 */
export interface HomeExample {
  number: string;
  title: string;
  body: string;
  exampleLabel: string;
  examplePath?: string | undefined;
}

export const HOME_EXAMPLES: readonly HomeExample[] = [
  {
    number: '01',
    title: 'A status tracker your agent keeps current.',
    body: 'Deployments, incidents, on-call — the agent rewrites the same page as things change and you open one link every morning. No dashboard to build, no attachments to chase.',
    exampleLabel: 'See a live status page',
    examplePath: undefined,
  },
  {
    number: '02',
    title: 'Proposals and recaps clients actually open.',
    body: 'Meeting notes, project proposals, and weekly updates go out as clean pages with a stable link, not a PDF in an inbox. Send once; when the work changes, the same link updates.',
    exampleLabel: 'See an example proposal',
    examplePath: undefined,
  },
  {
    number: '03',
    title: 'A daily digest on a template you define once.',
    body: 'A YouTube digest, a market brief, a standup summary — you set the layout, the agent fills it with fresh data on a schedule, and the page is current before you wake up.',
    exampleLabel: 'See a daily digest',
    examplePath: undefined,
  },
  {
    number: '04',
    title: 'Quick decision lists you can act on.',
    body: '"Which of these newsletters do I actually read?" The agent does the analysis and hands back a page you skim, flag, and reply to — and it revises the list from your feedback in place.',
    exampleLabel: 'See a decision list',
    examplePath: undefined,
  },
];

/**
 * Features, split into the bolded lead term and its explanation. The mockup emphasises the
 * capability word ("Versioning", "Templates") so the list scans as a capability index; passing
 * the label as its own node lets the page render it in `<strong>` without a second component.
 */
export interface HomeFeature {
  label: string;
  body: string;
}

export const HOME_FEATURES: readonly HomeFeature[] = [
  {
    label: 'Versioning',
    body: 'the agent edits the document, every change is kept, and the link stays the same.',
  },
  {
    label: 'Sharing',
    body: 'every artifact is a link. Public, private, or password protected.',
  },
  {
    label: 'Templates',
    body: 'define the layout once, the agent fills it with data, daily if you want.',
  },
  {
    label: 'HTML underneath',
    body: 'every artifact is an HTML page. If your agent can write markdown or HTML, it can publish.',
  },
];

/**
 * Agents the product works with, shown as an icon strip. Each logo is a real brand mark fetched
 * from the tool's own site and bundled under /assets/logos (no external request at render time).
 * `mark` is a monogram fallback for a tool whose logo is not sourced yet.
 */
export interface HomeTool {
  name: string;
  /** Served logo path under /assets/logos. When absent, the monogram `mark` shows instead. */
  icon?: string | undefined;
  mark?: string | undefined;
}

export const HOME_WORKS_WITH: readonly HomeTool[] = [
  { name: 'Grok Bot', icon: '/assets/logos/grok.svg' },
  { name: 'Claude Code', icon: '/assets/logos/claude.svg' },
  { name: 'Codex', icon: '/assets/logos/codex.png' },
  { name: 'Hermes Agents', icon: '/assets/logos/hermes.png' },
  { name: 'OpenClaw', icon: '/assets/logos/openclaw.svg' },
];

export interface HomePageProps {
  baseUrl: string;
  authenticated?: boolean | undefined;
  /**
   * Public repository URL. The repo is unpublished (docs/decisions.md, "Repository
   * publication status"), so this is unset by default and every GitHub affordance
   * disappears rather than linking somewhere that 404s.
   */
  githubUrl?: string | undefined;
  /** Live state of the hero artifact. Absent means the meta strip stays silent. */
  liveArtifact?: LiveArtifactMeta | null | undefined;
  now?: number | undefined;
}

export function HomePage({ baseUrl, authenticated = false, githubUrl }: HomePageProps) {
  const agentSkillUrl = heroArtifactUrl(baseUrl);
  // Display host for the copy-paste prompt: the agent reads the same /skill.md the footer links to,
  // shown without the scheme so the prompt stays readable ("agentartifact.ai/skill.md").
  const skillPromptUrl = `${baseUrl.replace(/^https?:\/\//, '')}/skill.md`;
  const pricingCtaHref = authenticated ? '/dashboard' : HOME_CTA_HREF;
  const pricingCtaLabel = authenticated ? HOME_AUTHENTICATED_CTA_LABEL : HOME_CTA_LABEL;

  return (
    <Layout title="Agent Artifacts" description={HOME_SUBLINE}>
      <header class="aa-app-header">
        <div class="aa-shell aa-marketing-shell aa-app-nav">
          <a class="aa-brand" href="/" aria-label="Agent Artifacts home">
            <ProductMark />
            <span>Agent Artifacts</span>
          </a>
          {/*
            The header carries one action per state below 560px. The authenticated state already
            did (Dashboard) and renders cleanly on one row; the anonymous state carried three, which
            is what forced the brand to break mid-name and the CTA to collide with the header rule.
            The secondary actions stand down on a phone rather than wrapping, and the footer keeps
            them reachable.
          */}
          <nav class="aa-button-row aa-home-actions" aria-label="Primary">
            {githubUrl ? (
              <Button variant="ghost" size="xs" href={githubUrl} class="aa-btn--compact-hide">
                GitHub
              </Button>
            ) : null}
            {authenticated ? (
              <Button variant="primary" size="xs" href="/dashboard">
                Dashboard
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="xs" href={HOME_CTA_HREF} class="aa-btn--compact-hide">
                  Log in
                </Button>
                <Button variant="primary" size="xs" href={HOME_CTA_HREF}>
                  {HOME_CTA_LABEL}
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main class="aa-main aa-marketing-main">
        <div class="aa-shell aa-marketing-shell">
          <section class="aa-marketing-hero" aria-labelledby="home-title">
            {/* The hero is itself an artifact — the product demonstrating its own output. The meta
                bar names the agent and shows the visibility control every real artifact carries;
                the body holds the pitch, the actions, and the copy-paste prompt that sets an agent
                up. Not componentised yet: this is a one-off hero and the style-guide pass is next. */}
            <article class="aa-marketing-hero-card">
              <header class="aa-marketing-artifact__meta aa-marketing-hero-card__meta">
                <span class="aa-marketing-artifact__dot" aria-hidden="true"></span>
                <span class="aa-marketing-artifact__agent">example-artifact</span>
                <span class="aa-marketing-chip">v1</span>
                {/* published + visibility form the right-hand cluster; the whole group stands down
                    on phones (the visibility control needs room the meta bar does not have there). */}
                <span class="aa-marketing-hero-card__meta-end">
                  <span class="aa-marketing-artifact__updated aa-marketing-hero-card__published">
                    published 3h ago
                  </span>
                  <span class="aa-marketing-visibility">
                    <label class="sr-only" for="home-visibility">
                      Artifact visibility
                    </label>
                    <select
                      id="home-visibility"
                      class="aa-marketing-visibility__select"
                      aria-label="Artifact visibility"
                    >
                      <option value="public" selected>
                        Public
                      </option>
                      <option value="private">Private</option>
                      <option value="password">Password protected</option>
                    </select>
                  </span>
                </span>
              </header>

              <div class="aa-marketing-hero-card__body">
                <h1 class="aa-marketing-hero-card__title" id="home-title">
                  {HOME_HERO}
                </h1>
                <p class="aa-marketing-hero-card__sub">{HOME_SUBLINE}</p>

                <div class="aa-marketing-hero-card__actions">
                  <Button variant="primary" href={authenticated ? '/dashboard' : HOME_CTA_HREF}>
                    {authenticated ? HOME_AUTHENTICATED_CTA_LABEL : HOME_HERO_CTA_LABEL}
                  </Button>
                  <Button variant="secondary" href={githubUrl ?? HOME_REPO_URL}>
                    View on GitHub
                  </Button>
                </div>

                <p class="aa-marketing-setup-label">Set up with your agent</p>
                <MarketingApiBlock id="home-prompt" label="Prompt">
                  {`Create a skill so you can publish to Agent Artifacts.\n`}
                  {`Read ${skillPromptUrl} and set it up.`}
                </MarketingApiBlock>
              </div>
            </article>
          </section>

          <MarketingSection id="home-examples" label="Examples" title="What people use it for">
            <div class="aa-marketing-grid">
              {HOME_EXAMPLES.map((example) => (
                <MarketingExampleCard number={example.number}>
                  <strong class="aa-marketing-example__title">{example.title}</strong>
                  <span class="aa-marketing-example__body">{example.body}</span>
                  {example.examplePath ? (
                    <a class="aa-marketing-example__link" href={example.examplePath}>
                      {example.exampleLabel}
                      <span aria-hidden="true"> →</span>
                    </a>
                  ) : null}
                </MarketingExampleCard>
              ))}
            </div>
          </MarketingSection>

          <MarketingSection id="home-features" label="Features">
            <div class="aa-marketing-features">
              {HOME_FEATURES.map((feature) => (
                <MarketingFeatureLine>
                  <strong class="aa-marketing-feature__label">{feature.label}:</strong>{' '}
                  {feature.body}
                </MarketingFeatureLine>
              ))}
            </div>
          </MarketingSection>

          <MarketingSection id="home-works" label="Works with">
            <ul class="aa-marketing-logos" aria-label="Works with these agents">
              {HOME_WORKS_WITH.map((tool) => (
                <li class="aa-marketing-logo">
                  <span
                    class={`aa-marketing-logo__mark${
                      tool.icon ? '' : ' aa-marketing-logo__mark--text'
                    }`}
                    aria-hidden="true"
                  >
                    {tool.icon ? (
                      <img src={tool.icon} alt="" width="22" height="22" loading="lazy" />
                    ) : (
                      tool.mark
                    )}
                  </span>
                  <span class="aa-marketing-logo__name">{tool.name}</span>
                </li>
              ))}
            </ul>
            <MarketingWorksWith>and any agent that can make an HTTP request.</MarketingWorksWith>
          </MarketingSection>

          <MarketingSection id="home-origin" label="Why this exists">
            <MarketingOriginNote quote={HOME_ORIGIN_QUOTE} />
          </MarketingSection>

          <MarketingSection id="home-pricing" label="Pricing" title="Start free. Keep what matters.">
            <div class="aa-marketing-pricing">
              <article class="aa-marketing-plan">
                <header class="aa-marketing-plan__head">
                  <h3 class="aa-marketing-plan__name">Free</h3>
                  <p class="aa-marketing-plan__price">
                    <span class="aa-marketing-plan__amount">$0</span>
                  </p>
                  <p class="aa-marketing-plan__note">No card. Publish in a minute.</p>
                </header>
                <ul class="aa-marketing-plan__features">
                  <li>Publish straight from your agent</li>
                  <li>Versioning, templates &amp; sharing</li>
                  <li>Public, shareable hashed links</li>
                  <li>Artifacts live 7 days, then fade</li>
                </ul>
                <Button variant="secondary" href={pricingCtaHref} fullWidth>
                  {pricingCtaLabel}
                </Button>
              </article>

              <article class="aa-marketing-plan aa-marketing-plan--featured">
                <span class="aa-marketing-plan__badge">Most popular</span>
                <header class="aa-marketing-plan__head">
                  <h3 class="aa-marketing-plan__name">Pro</h3>
                  <p class="aa-marketing-plan__price">
                    <span class="aa-marketing-plan__amount">$9</span>
                    <span class="aa-marketing-plan__period">/mo</span>
                  </p>
                  <p class="aa-marketing-plan__note">For work that sticks around.</p>
                </header>
                <ul class="aa-marketing-plan__features">
                  <li>Everything in Free</li>
                  <li>Artifacts live forever</li>
                  <li>Your own subdomain</li>
                  <li>No footer but yours</li>
                  <li>Password-protected shares</li>
                </ul>
                <Button variant="primary" href={pricingCtaHref} fullWidth>
                  {pricingCtaLabel}
                </Button>
              </article>
            </div>

            <aside class="aa-marketing-selfhost">
              <div class="aa-marketing-selfhost__text">
                <h3 class="aa-marketing-selfhost__title">Self-host? No problem.</h3>
                <p>
                  Agent Artifacts is MIT licensed and self-hostable, end to end — run the whole
                  thing on your own infrastructure.
                </p>
              </div>
              <Button variant="secondary" href={githubUrl ?? HOME_REPO_URL}>
                View on GitHub
              </Button>
            </aside>
          </MarketingSection>
        </div>
      </main>

      <MarketingFooter>
        {githubUrl ? (
          <>
            <a href={githubUrl}>GitHub</a>
            <span class="aa-marketing-separator" aria-hidden="true">
              ·
            </span>
          </>
        ) : null}
        <a href="/skill.md">Agent Skill</a>
        <span class="aa-marketing-separator" aria-hidden="true">
          ·
        </span>
        <a href="/llms.txt">API contract</a>
        {authenticated ? null : (
          <>
            <span class="aa-marketing-separator" aria-hidden="true">
              ·
            </span>
            <a href={HOME_CTA_HREF}>Log in</a>
          </>
        )}
        <span class="aa-marketing-separator" aria-hidden="true">
          ·
        </span>
        <a href={agentSkillUrl}>Live artifact</a>
      </MarketingFooter>
    </Layout>
  );
}
