import { formatUpdatedLabel, type LiveArtifactMeta } from '../../services/live-artifact-meta.js';
import { Layout } from '../components/layout.js';
import {
  MarketingApiBlock,
  MarketingArtifactEmbed,
  MarketingExampleCard,
  MarketingFeatureLine,
  MarketingFinalCta,
  MarketingFooter,
  MarketingOriginNote,
  MarketingSection,
  MarketingTermsCard,
  MarketingWorksWith,
} from '../components/marketing.js';
import { Button, ProductMark } from '../components/primitives.js';

export const HOME_HERO = 'Artifacts for Agents';
export const HOME_SUBLINE = 'Shareable Artifacts your agent can use to show its work.';
export const HOME_AGENT_SKILL_COPY =
  'An agent reads one skill file to learn how to publish here: base URL, auth header, create, update, share.';
export const HOME_ORIGIN_QUOTE =
  "I asked my bot for something simple: a visual list of newsletters I should probably unsubscribe from, so I could make quick decisions. It did the work, then handed me an HTML file to download. I didn't want a file. I wanted a link I could open, look through, and reply to, with the bot fixing what I flagged. That link is what we built.";

export const HOME_CTA_LABEL = 'Get your key';
export const HOME_CTA_HREF = '/login?mode=magic';
export const HOME_CTA_REASSURANCE = 'Hashed URL · free · no card';
export const HOME_AUTHENTICATED_CTA_LABEL = 'Open your dashboard';

export const HOME_DEMO_ARTIFACTS = [
  {
    title: 'Agent Skill',
    description: 'A real artifact that explains how agents publish here.',
    slugLabel: 'this-is-artifact',
    path: '/a/KbLJ0zvyiGadXLHUs2E5Rb',
  },
] as const;

export const HOME_AGENT_SKILL_ARTIFACT = HOME_DEMO_ARTIFACTS[0];

const examples = [
  {
    number: '01',
    lead: 'A status tracker',
    rest: 'your agent keeps current. You open the same link every morning.',
  },
  {
    number: '02',
    lead: 'Proposals and meeting recaps',
    rest: 'that go to clients as clean pages, not attachments.',
  },
  {
    number: '03',
    lead: 'A YouTube daily digest:',
    rest: 'a custom template your agent fills with fresh data every day.',
  },
  {
    number: '04',
    lead: 'Quick decision lists,',
    rest: 'like "which of these newsletters do I actually read?"',
  },
] as const;

const features = [
  'Versioning: the agent edits the document, every change is kept, the link stays the same.',
  'Sharing: every artifact is a link. Public, private, or password protected.',
  'Templates: define the layout once, the agent fills it with data, daily if you want.',
  'HTML underneath: every artifact is an HTML page. If your agent can write markdown or HTML, it can publish.',
] as const;

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

export function buildHomeDemoArtifactUrl(baseUrl: string, artifactPath: string) {
  const url = new URL(baseUrl);
  url.hostname = url.hostname.replace('-cloud.', '.');
  return `${url.origin}${artifactPath}`;
}

/** Public URL of the artifact the hero card is built from. */
export function heroArtifactUrl(baseUrl: string): string {
  return buildHomeDemoArtifactUrl(baseUrl, HOME_AGENT_SKILL_ARTIFACT.path);
}

export function HomePage({
  baseUrl,
  authenticated = false,
  githubUrl,
  liveArtifact = null,
  now,
}: HomePageProps) {
  const agentSkillUrl = heroArtifactUrl(baseUrl);
  const updatedLabel = liveArtifact
    ? (formatUpdatedLabel(liveArtifact.updatedAt, now ?? Date.now()) ?? undefined)
    : undefined;
  const versionLabel = liveArtifact?.versionLabel;

  return (
    <Layout title="Agent Artifacts" description={HOME_SUBLINE}>
      <header class="aa-app-header">
        <div class="aa-shell aa-marketing-shell aa-app-nav">
          <a class="aa-brand" href="/" aria-label="Agent Artifacts home">
            <ProductMark />
            <span>Agent Artifacts</span>
          </a>
          <nav class="aa-specimen-row aa-home-actions" aria-label="Primary">
            {githubUrl ? (
              <Button variant="ghost" size="sm" href={githubUrl}>
                GitHub
              </Button>
            ) : null}
            {authenticated ? (
              <Button variant="primary" size="sm" href="/dashboard">
                Dashboard
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" href={HOME_CTA_HREF}>
                  Log in
                </Button>
                <Button variant="primary" size="sm" href={HOME_CTA_HREF}>
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
            <div class="aa-marketing-hero__copy">
              <h1 class="aa-marketing-hero__title" id="home-title">
                {HOME_HERO}
              </h1>
              <p class="aa-marketing-hero__sub">
                Shareable Artifacts your agent
                <br aria-hidden="true" /> can use to show its work.
              </p>
            </div>

            <MarketingArtifactEmbed
              href={agentSkillUrl}
              agentLabel="demo-showcase-agent"
              slugLabel={HOME_AGENT_SKILL_ARTIFACT.slugLabel}
              version={versionLabel}
              updatedLabel={updatedLabel}
              title={HOME_AGENT_SKILL_ARTIFACT.title}
              headingLevel={2}
              ariaLabel="Open the live Agent Skill artifact"
            >
              <p>{HOME_AGENT_SKILL_COPY}</p>
              <p>
                Read <a href="/skill.md">/skill.md</a> for the canonical machine-readable skill.
              </p>
            </MarketingArtifactEmbed>
          </section>

          <MarketingSection id="home-examples" label="Examples" title="What people use it for">
            <div class="aa-marketing-grid">
              {examples.map((example) => (
                <MarketingExampleCard number={example.number}>
                  <strong>{example.lead}</strong> {example.rest}
                </MarketingExampleCard>
              ))}
            </div>
          </MarketingSection>

          <MarketingSection id="home-api" label="How it works" title="Send a link, not a file.">
            <div class="aa-marketing-api-wrap">
              <MarketingApiBlock id="home-api-code" label="The whole API">
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
          </MarketingSection>

          <MarketingSection id="home-features" label="Features">
            <div class="aa-marketing-features">
              {features.map((feature) => (
                <MarketingFeatureLine>{feature}</MarketingFeatureLine>
              ))}
            </div>
          </MarketingSection>

          <MarketingSection id="home-works" label="Works with">
            <MarketingWorksWith>
              <strong>Grok Bot, Claude Code, Codex, Hermes Agents, Openclaw,</strong> and any agent
              that can make an HTTP request.
            </MarketingWorksWith>
          </MarketingSection>

          <MarketingSection id="home-origin" label="Why this exists">
            <MarketingOriginNote quote={HOME_ORIGIN_QUOTE} />
          </MarketingSection>

          <MarketingSection id="home-terms" label="Pricing and open source">
            <MarketingTermsCard
              price="Free artifacts live for seven days, then fade. For $9 a month they live forever, on your own subdomain, with no footer but yours."
              oss={
                githubUrl ? (
                  <>
                    MIT licensed and self-hostable, end to end.{' '}
                    <a href={githubUrl}>Star it on GitHub.</a>
                  </>
                ) : (
                  'MIT licensed and self-hostable, end to end.'
                )
              }
            />
            <MarketingFinalCta
              href={authenticated ? '/dashboard' : HOME_CTA_HREF}
              label={authenticated ? HOME_AUTHENTICATED_CTA_LABEL : HOME_CTA_LABEL}
              note={authenticated ? undefined : HOME_CTA_REASSURANCE}
            />
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
        <span class="aa-marketing-separator" aria-hidden="true">
          ·
        </span>
        <a href={agentSkillUrl}>Live artifact</a>
      </MarketingFooter>
    </Layout>
  );
}
