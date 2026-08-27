import { Layout } from '../components/layout.js';
import { Badge, Button, Card, CopyBlock, Input, ProductMark } from '../components/primitives.js';
import { buildArtifactCurl, buildInstallPrompt } from './dashboard.js';

export interface SetupPageProps {
  baseUrl: string;
  error?: string | undefined;
  email?: string | undefined;
  botName?: string | undefined;
  botByline?: string | undefined;
}

export function SetupPage({
  baseUrl,
  error,
  email = '',
  botName = '',
  botByline = '',
}: SetupPageProps) {
  return (
    <Layout
      title="Setup · Agent Artifacts"
      description="Create the first Agent Artifacts admin and bot."
    >
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">Self-hosted first run</p>
                <h1 class="aa-section-title">Set up Agent Artifacts</h1>
                <p class="aa-section-note">
                  Create the admin account, name your first bot, and copy the key shown once.
                </p>
              </div>
              <div class="aa-specimen-row">
                <Badge tone="accent">1 Token</Badge>
                <Badge tone="neutral">2 Admin</Badge>
                <Badge tone="neutral">3 Bot</Badge>
                <Badge tone="neutral">4 Key</Badge>
              </div>
              {error ? <p class="aa-error">{error}</p> : null}
              <form class="aa-stack" method="post" action="/setup">
                <Input
                  id="setup_token"
                  name="setup_token"
                  label="Setup token"
                  type="password"
                  hint="Find this one-time token in the server boot log."
                />
                <Input
                  id="email"
                  name="email"
                  label="Admin email"
                  type="email"
                  value={email}
                  placeholder="you@example.com"
                />
                <Input id="password" name="password" label="Password" type="password" />
                <Input
                  id="password_confirm"
                  name="password_confirm"
                  label="Confirm password"
                  type="password"
                />
                <Input
                  id="bot_name"
                  name="bot_name"
                  label="First bot name"
                  value={botName}
                  placeholder="R2"
                />
                <Input
                  id="bot_byline"
                  name="bot_byline"
                  label="Bot byline"
                  value={botByline}
                  placeholder="Andrej's Chief of Staff"
                  optional
                />
                <div class="aa-specimen-row">
                  <Button variant="primary" type="submit">
                    Create admin and bot
                  </Button>
                  <Badge tone="info">{baseUrl}</Badge>
                </div>
              </form>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

export interface SetupKeyPageProps {
  baseUrl: string;
  email: string;
  botName: string;
  apiKey: string;
}

export function SetupKeyPage({ baseUrl, email, botName, apiKey }: SetupKeyPageProps) {
  const installPrompt = buildInstallPrompt({ baseUrl, apiKey, botName });
  const curl = buildArtifactCurl({ baseUrl, apiKey, botName });

  return (
    <Layout
      title="Your bot key · Agent Artifacts"
      description="Copy your Agent Artifacts bot key and install prompt."
      scripts={['/assets/dashboard-m4.js']}
    >
      <main class="aa-main">
        <div class="aa-shell aa-shell--narrow aa-stack">
          <header>
            <p class="aa-page-kicker">Setup complete</p>
            <h1 class="aa-page-title">Copy this key now.</h1>
            <p class="aa-page-lede">
              The admin account {email} is ready. This key is shown only once; if you lose it,
              regenerate the bot key from the dashboard.
            </p>
          </header>
          <Card title="Your bot's key" description="Shown once. Store it in your agent secrets.">
            <div class="aa-stack">
              <Badge tone="warn">Shown only once</Badge>
              <CopyBlock id="setup-key" label="API key" value={apiKey} />
              <CopyBlock id="setup-install-prompt" label="Install prompt" value={installPrompt} />
              <CopyBlock id="setup-curl" label="Create your first artifact" value={curl} />
              <div class="aa-specimen-row">
                <Button
                  variant="primary"
                  href="/dashboard"
                  dataAttrs={{ 'data-aa-setup-continue': 'true' }}
                >
                  Open dashboard →
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

export function SetupUnavailablePage() {
  return (
    <Layout title="Setup unavailable · Agent Artifacts" description="Setup is already complete.">
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <ProductMark />
              <h1 class="aa-section-title">Setup is already complete.</h1>
              <p class="aa-section-note">
                This wizard is available only before the first account exists.
              </p>
              <Button variant="primary" href="/login">
                Log in
              </Button>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}
