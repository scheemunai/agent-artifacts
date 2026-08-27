import { Layout } from '../components/layout.js';
import { Badge, Button, Card, CopyBlock, ProductMark } from '../components/primitives.js';
import { buildInstallPrompt } from './dashboard.js';

export const GITHUB_REPOSITORY = 'ZeroPointRepo/agent-artifacts';
export const GITHUB_URL = `https://github.com/${GITHUB_REPOSITORY}`;
export const HOME_HERO = 'Your agent does the work. Artifacts is where it shows the work.';
export const HOME_SUBLINE =
  "One POST turns your agent's markdown or HTML into a beautiful, versioned, shareable page — stable URL, live updates, optional password.";
export const HOME_DEMO_COPY =
  'Two real artifacts, published through the live API: a templated report and a sandboxed HTML dashboard. Update the same slug later; the public link stays put.';
export const HOME_REPORT_ARTIFACT_URL =
  'https://agentartifact.anacreon.ai/a/EUMZD1RSHBZgHya2ZoNWxQ';
export const HOME_HTML_ARTIFACT_URL = 'https://agentartifact.anacreon.ai/a/-jNreL9Menxh1DmknwfOT-';

const HOME_DEMO_ARTIFACTS = [
  {
    title: 'Templated report',
    description: 'Markdown through the built-in report template.',
    badge: 'report',
    href: HOME_REPORT_ARTIFACT_URL,
    action: 'Open report →',
  },
  {
    title: 'Sandboxed HTML dashboard',
    description: 'Self-contained HTML rendered inside the sandboxed frame.',
    badge: 'html',
    href: HOME_HTML_ARTIFACT_URL,
    action: 'Open dashboard →',
  },
] as const;

export interface HomePageProps {
  baseUrl: string;
  authenticated?: boolean | undefined;
}

export function HomePage({ baseUrl, authenticated = false }: HomePageProps) {
  const installPrompt = buildInstallPrompt({
    baseUrl,
    apiKey: '[KEY]',
    botName: '[BOT NAME]',
  });

  return (
    <Layout title="Agent Artifacts" description={HOME_SUBLINE}>
      <header class="aa-app-header">
        <div class="aa-shell aa-shell--narrow aa-app-nav">
          <a class="aa-brand" href="/" aria-label="Agent Artifacts home">
            <ProductMark />
            <span>Agent Artifacts</span>
          </a>
          <nav class="aa-specimen-row aa-home-actions" aria-label="Primary">
            {authenticated ? (
              <Button variant="primary" href="/dashboard">
                Dashboard →
              </Button>
            ) : (
              <>
                <Button variant="ghost" href="/login?mode=magic">
                  Log in
                </Button>
                <Button variant="primary" href="/login?mode=magic">
                  Sign up
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main class="aa-main">
        <div class="aa-shell aa-home-shell aa-stack">
          <section class="aa-section aa-home-hero" aria-labelledby="home-title">
            <p class="aa-page-kicker">◆ Agent Artifacts</p>
            <h1 class="aa-page-title aa-home-title" id="home-title">
              {HOME_HERO}
            </h1>
            <p class="aa-page-lede">{HOME_SUBLINE}</p>
          </section>

          <div class="aa-home-body aa-stack">
            <section class="aa-section" aria-labelledby="home-demo">
              <div class="aa-section-header">
                <h2 class="aa-section-title" id="home-demo">
                  See the work
                </h2>
                <p class="aa-section-note">{HOME_DEMO_COPY}</p>
              </div>
              <div class="aa-grid aa-grid--2">
                {HOME_DEMO_ARTIFACTS.map((artifact) => (
                  <Card title={artifact.title} description={artifact.description}>
                    <div class="aa-stack">
                      <Badge tone={artifact.badge === 'html' ? 'info' : 'success'}>
                        {artifact.badge}
                      </Badge>
                      <Button variant="secondary" href={artifact.href}>
                        {artifact.action}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>

            <section class="aa-section" aria-labelledby="home-install">
              <div class="aa-section-header">
                <h2 class="aa-section-title" id="home-install">
                  Give your agent an Artifacts account
                </h2>
                <p class="aa-section-note">Sign up to get your key.</p>
              </div>
              <CopyBlock id="home-install-prompt" label="Install prompt" value={installPrompt} />
            </section>

            <Card>
              <div class="aa-specimen-row">
                <Button variant="secondary" href={GITHUB_URL}>
                  ★ Star on GitHub
                </Button>
                <Button variant="primary" href="/login?mode=magic">
                  Sign up free →
                </Button>
              </div>
            </Card>

            <p class="aa-section-note">
              Free: 1 bot, 25 artifacts. Pro ($9/mo) — unlimited bots, no footer, custom subdomain —
              coming soon.
            </p>
          </div>
        </div>
      </main>

      <footer class="aa-shell aa-shell--narrow">
        <p class="aa-hint">
          ◆ Agent Artifacts · <a href={GITHUB_URL}>GitHub</a> ·{' '}
          <a href="/llms.txt">API contract (/llms.txt)</a> · MIT
        </p>
      </footer>
    </Layout>
  );
}
