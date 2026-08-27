import { Layout } from '../components/layout.js';
import { Badge, Button, Card, Input, ProductMark } from '../components/primitives.js';

export interface LoginPageProps {
  mode: 'password' | 'magic';
  email?: string | undefined;
  error?: string | undefined;
  sent?: boolean | undefined;
  mailAvailable?: boolean | undefined;
}

export function LoginPage({
  mode,
  email = '',
  error,
  sent = false,
  mailAvailable = false,
}: LoginPageProps) {
  const isMagic = mode === 'magic';
  const title = isMagic ? 'Sign in to Agent Artifacts' : 'Log in to Agent Artifacts';

  return (
    <Layout
      title={`${title} · Agent Artifacts`}
      description="Sign in to publish and manage your agent artifacts."
    >
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">Human dashboard</p>
                <h1 class="aa-section-title">{title}</h1>
                <p class="aa-section-note">
                  {isMagic
                    ? 'Enter your email and we will send a 15-minute sign-in link.'
                    : 'Use the admin email and password from your self-hosted setup.'}
                </p>
              </div>

              {sent ? (
                <MagicLinkSentCard email={email} />
              ) : (
                <form class="aa-stack" method="post" action="/login">
                  <input type="hidden" name="mode" value={mode} />
                  <Input
                    id="email"
                    name="email"
                    label="Email"
                    type="email"
                    value={email}
                    placeholder="you@example.com"
                    error={error && isMagic ? error : undefined}
                  />
                  {isMagic ? null : (
                    <Input
                      id="password"
                      name="password"
                      label="Password"
                      type="password"
                      error={error && !isMagic ? error : undefined}
                    />
                  )}
                  <div class="aa-specimen-row">
                    <Button variant="primary" type="submit">
                      {isMagic ? 'Email me a link' : 'Log in'}
                    </Button>
                    {mailAvailable && !isMagic ? (
                      <Button variant="secondary" href="/login?mode=magic">
                        Email me a link instead
                      </Button>
                    ) : null}
                    {isMagic ? <Badge tone="info">15-minute link</Badge> : null}
                  </div>
                  {isMagic ? (
                    <p class="aa-hint">
                      You will see the same confirmation whether or not an account exists.
                    </p>
                  ) : null}
                </form>
              )}
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

export function MagicLinkInterstitialPage({ token }: { token: string }) {
  return (
    <Layout
      title="Continue sign-in · Agent Artifacts"
      description="Continue sign-in to Agent Artifacts."
    >
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">Email verified</p>
                <h1 class="aa-section-title">Sign in to Agent Artifacts</h1>
                <p class="aa-section-note">
                  Continue below to finish signing in. This page is safe for email scanners because
                  it does not consume the link until you submit the form.
                </p>
              </div>
              <form method="post" action="/auth/verify" class="aa-specimen-row">
                <input type="hidden" name="token" value={token} />
                <Button variant="primary" type="submit">
                  Continue
                </Button>
                <Button variant="secondary" href="/login?mode=magic">
                  Send a new link
                </Button>
              </form>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

export function MagicLinkExpiredPage({ email = '' }: { email?: string }) {
  return (
    <Layout title="Link expired · Agent Artifacts" description="Magic sign-in link expired.">
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">Sign-in link</p>
                <h1 class="aa-section-title">That link has expired.</h1>
                <p class="aa-section-note">
                  Links are single-use and last 15 minutes. Send yourself a fresh link to continue.
                </p>
              </div>
              <form class="aa-stack" method="post" action="/login">
                <input type="hidden" name="mode" value="magic" />
                <Input
                  id="email"
                  name="email"
                  label="Email"
                  type="email"
                  value={email}
                  placeholder="you@example.com"
                />
                <Button variant="primary" type="submit">
                  Send a new link
                </Button>
              </form>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

export function EmailChangeInterstitialPage({ token }: { token: string }) {
  return (
    <Layout
      title="Confirm email change · Agent Artifacts"
      description="Confirm your Agent Artifacts email change."
    >
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">Email change</p>
                <h1 class="aa-section-title">Confirm your new email</h1>
                <p class="aa-section-note">
                  Continue below to update the dashboard email. This page is safe for email scanners
                  because it does not consume the link until you submit the form.
                </p>
              </div>
              <form method="post" action="/auth/change-email" class="aa-specimen-row">
                <input type="hidden" name="token" value={token} />
                <Button variant="primary" type="submit">
                  Update email
                </Button>
                <Button variant="secondary" href="/dashboard/settings">
                  Back to settings
                </Button>
              </form>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

export function EmailChangeExpiredPage({ email = '' }: { email?: string }) {
  return (
    <Layout title="Email link expired · Agent Artifacts" description="Email-change link expired.">
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">Email change</p>
                <h1 class="aa-section-title">That email-change link is no longer valid.</h1>
                <p class="aa-section-note">
                  Links are single-use and last 15 minutes. Return to settings and request a fresh
                  link{email ? ` for ${email}` : ''}.
                </p>
              </div>
              <Button variant="primary" href="/dashboard/settings">
                Back to settings
              </Button>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

function MagicLinkSentCard({ email }: { email: string }) {
  return (
    <section class="aa-stack" aria-live="polite">
      <Badge tone="success">Link sent</Badge>
      <div>
        <h2 class="aa-section-title">Check your email</h2>
        <p class="aa-section-note">
          We sent a sign-in link to {email || 'that address'}. It expires in 15 minutes.
        </p>
      </div>
      <p class="aa-hint">
        For privacy, this confirmation is identical for known and unknown addresses.
      </p>
      <Button variant="secondary" href="/login?mode=magic">
        Use a different email
      </Button>
    </section>
  );
}
