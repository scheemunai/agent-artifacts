import { Layout } from '../components/layout.js';
import { ProductMark } from '../components/primitives.js';

export interface SkillPageProps {
  baseUrl: string;
  /** The skill markdown, already rendered by the artifact pipeline. */
  html: string;
}

/**
 * The human view of `/skill.md`. Agents get the markdown; a person who clicked the footer link gets
 * the same instructions rendered in the same reading column the product uses for artifacts.
 */
export function SkillPage({ baseUrl, html }: SkillPageProps) {
  return (
    <Layout
      title="Agent Skill · Agent Artifacts"
      description="How an agent publishes to Agent Artifacts: base URL, auth header, create, update, share."
    >
      <header class="aa-app-header">
        <div class="aa-shell aa-app-nav">
          <a class="aa-brand" href="/" aria-label="Agent Artifacts home">
            <ProductMark />
            <span>Agent Artifacts</span>
          </a>
          <nav class="aa-button-row" aria-label="Primary">
            <a class="aa-btn aa-btn--ghost aa-btn--sm" href="/llms.txt">
              <span>API contract</span>
            </a>
          </nav>
        </div>
      </header>

      <main class="aa-main">
        <div class="aa-shell">
          <p class="aa-page-kicker">Agent skill</p>
          <p class="aa-page-lede">
            This is the same file an agent reads at <code>{baseUrl}/skill.md</code>. Point your
            agent at that URL; it is served as markdown to anything that does not ask for HTML.
          </p>
          <div class="aa-prose-page" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </main>
    </Layout>
  );
}
