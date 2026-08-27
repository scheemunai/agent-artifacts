import { Layout } from '../components/layout.js';
import {
  Badge,
  Button,
  ButtonRow,
  Card,
  CopyBlock,
  Input,
  Notice,
  ProductMark,
} from '../components/primitives.js';
import { buildArtifactCurl, buildInstallPrompt, buildRedactedInstallPrompt } from './dashboard.js';

/** Fields a setup failure can be attributed to, so the message can ride the field that caused it. */
export type SetupErrorField = 'setup_token' | 'password' | 'password_confirm' | 'bot_name';

export interface SetupPageProps {
  baseUrl: string;
  error?: string | undefined;
  /**
   * Which field the error belongs to. Rung 2 of the attachment ladder: a message about one field
   * belongs on that field, not ~300px above it where the field is off-screen at 375.
   */
  errorField?: SetupErrorField | undefined;
  /**
   * The submitted setup token, round-tripped on error. This is a one-time value the operator reads
   * out of the server boot log, so dropping it on a validation slip costs them a trip back to the
   * terminal. It is the worst field on the form to clear.
   */
  setupToken?: string | undefined;
  email?: string | undefined;
  botName?: string | undefined;
  botByline?: string | undefined;
}

export function SetupPage({
  baseUrl,
  error,
  errorField,
  setupToken = '',
  email = '',
  botName = '',
  botByline = '',
}: SetupPageProps) {
  const fieldError = (field: SetupErrorField) =>
    error && errorField === field ? error : undefined;
  const formError = error && !errorField ? error : undefined;

  return (
    <Layout
      title="Setup · Agent Artifacts"
      description="Create the first Agent Artifacts admin and bot."
    >
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card
            raised
            notice={
              formError ? (
                <Notice tone="danger" title="Setup could not complete">
                  {formError}
                </Notice>
              ) : undefined
            }
          >
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">Self-hosted first run</p>
                <h1 class="aa-section-title">Set up Agent Artifacts</h1>
                <p class="aa-section-note">
                  One form, all at once: the admin account, your first bot, and the key shown once
                  on the next screen.
                </p>
              </div>
              <form class="aa-stack" method="post" action="/setup">
                <Input
                  id="setup_token"
                  name="setup_token"
                  label="Setup token"
                  type="password"
                  // Masked because it is a secret, not because it is a password. This is a code the
                  // operator reads out of the boot log once and never uses again, so a manager must
                  // not offer to save it as the site password. `off` would be the wrong instrument:
                  // browsers deliberately ignore it on password-typed fields so that managers keep
                  // working. Naming the field truthfully is what actually changes the behaviour.
                  autocomplete="one-time-code"
                  value={setupToken}
                  hint="Find this one-time token in the server boot log."
                  error={fieldError('setup_token')}
                />
                <Input
                  id="email"
                  name="email"
                  label="Admin email"
                  type="email"
                  value={email}
                  placeholder="you@example.com"
                />
                <Input
                  id="password"
                  name="password"
                  label="Password"
                  type="password"
                  autocomplete="new-password"
                  error={fieldError('password')}
                />
                <Input
                  id="password_confirm"
                  name="password_confirm"
                  label="Confirm password"
                  type="password"
                  autocomplete="new-password"
                  error={fieldError('password_confirm')}
                />
                <Input
                  id="bot_name"
                  name="bot_name"
                  label="First bot name"
                  value={botName}
                  placeholder="R2"
                  error={fieldError('bot_name')}
                />
                <Input
                  id="bot_byline"
                  name="bot_byline"
                  label="Bot byline"
                  value={botByline}
                  placeholder="Andrej's Chief of Staff"
                  optional
                />
                <ButtonRow>
                  <Button variant="primary" type="submit">
                    Create admin and bot
                  </Button>
                  <Badge tone="info">{baseUrl}</Badge>
                </ButtonRow>
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
      scripts={['dashboard.js']}
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
              <CopyBlock id="setup-key" label="API key" value={apiKey} variant="credential" />
              <CopyBlock id="setup-install-prompt" label="Install prompt" value={installPrompt} />
              <CopyBlock id="setup-curl" label="Create your first artifact" value={curl} />
              <ButtonRow>
                <Button
                  variant="primary"
                  href="/dashboard"
                  dataAttrs={{ 'data-aa-setup-continue': 'true' }}
                >
                  Open dashboard →
                </Button>
              </ButtonRow>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

export interface SetupKeyHiddenPageProps {
  baseUrl: string;
  email: string;
  botName?: string | undefined;
  apiKeyLast4?: string | null | undefined;
}

export function SetupKeyHiddenPage({
  baseUrl,
  email,
  botName = 'your bot',
  apiKeyLast4,
}: SetupKeyHiddenPageProps) {
  return (
    <Layout
      title="Key hidden · Agent Artifacts"
      description="The first bot key was already shown once."
    >
      <main class="aa-main">
        <div class="aa-shell aa-shell--narrow aa-stack">
          <header>
            <p class="aa-page-kicker">Setup complete</p>
            <h1 class="aa-page-title">Your key was already shown once.</h1>
            <p class="aa-page-lede">
              The admin account {email} is ready. For safety, full API keys are hidden after their
              first reveal. If you lost the key, regenerate it from the dashboard.
            </p>
          </header>
          <Card title="Safe state" description="No secret is rendered on refresh.">
            <div class="aa-stack">
              <Badge tone="warn">
                {apiKeyLast4 ? `Hidden now · aa_bot_…${apiKeyLast4}` : 'Hidden now'}
              </Badge>
              {apiKeyLast4 ? (
                <CopyBlock
                  id="setup-install-prompt-redacted"
                  label="Install prompt (key redacted)"
                  value={buildRedactedInstallPrompt({ baseUrl, botName, last4: apiKeyLast4 })}
                />
              ) : null}
              <ButtonRow>
                <Button variant="primary" href="/dashboard">
                  Open dashboard →
                </Button>
                <Button variant="secondary" href="/dashboard/bots">
                  Regenerate key
                </Button>
              </ButtonRow>
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
