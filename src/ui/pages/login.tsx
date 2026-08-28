import { Layout } from '../components/layout.js';
import {
  Badge,
  Button,
  ButtonRow,
  Card,
  Input,
  Notice,
  PasswordInput,
  ProductMark,
  StatusHeading,
} from '../components/primitives.js';

export interface LoginPageProps {
  mode: 'password' | 'magic';
  email?: string | undefined;
  error?: string | undefined;
  sent?: boolean | undefined;
  mailAvailable?: boolean | undefined;
  /**
   * The visitor asked for magic-link sign-in on an instance that cannot send mail. Says so, rather
   * than letting the request fail as a credential error it never was.
   */
  magicUnavailable?: boolean | undefined;
}

export function LoginPage({
  mode,
  email = '',
  error,
  sent = false,
  mailAvailable = false,
  magicUnavailable = false,
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
          <Card
            raised
            notice={
              magicUnavailable ? (
                <Notice tone="info" title="Magic-link sign-in is not enabled here">
                  This instance has no mail transport configured, so there is no address to send a
                  link from. Sign in with your password below.
                </Notice>
              ) : undefined
            }
          >
            <div class="aa-stack aa-placeholder-card">
              {/*
                A screen's header is part of its state. Rendering the "enter your email" header
                unconditionally left the sent screen instructing and confirming the same action at
                once. Success states own their own heading.
              */}
              {sent ? (
                <MagicLinkSentCard email={email} />
              ) : (
                <>
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
                  <form class="aa-stack" method="post" action="/login">
                    <input type="hidden" name="mode" value={mode} />
                    <Input
                      id="email"
                      name="email"
                      label="Email"
                      type="email"
                      value={email}
                      placeholder="you@example.com"
                      // The first actionable field in both modes, on a page whose only job is this
                      // form. Never the password box: focus belongs where typing starts.
                      autofocus
                      error={error && isMagic ? error : undefined}
                    />
                    {isMagic ? null : (
                      <PasswordInput
                        id="password"
                        name="password"
                        label="Password"
                        autocomplete="current-password"
                        error={error && !isMagic ? error : undefined}
                      />
                    )}
                    <ButtonRow>
                      <Button variant="primary" type="submit">
                        {isMagic ? 'Email me a link' : 'Log in'}
                      </Button>
                      {mailAvailable && !isMagic ? (
                        <Button variant="secondary" href="/login?mode=magic">
                          Email me a link instead
                        </Button>
                      ) : null}
                      {isMagic ? <Badge tone="info">15-minute link</Badge> : null}
                    </ButtonRow>
                    {isMagic ? (
                      <p class="aa-hint">
                        You will see the same confirmation whether or not an account exists.
                      </p>
                    ) : null}
                  </form>
                </>
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
                {/*
                  Not "Email verified". This page is reached by a GET, and a GET deliberately does
                  not consume the link, so nothing has been verified yet: the token may be expired,
                  already used, or fabricated. The kicker names the object in hand, not a state the
                  page has not reached.
                */}
                <p class="aa-page-kicker">Sign-in link</p>
                <h1 class="aa-section-title">Sign in to Agent Artifacts</h1>
                <p class="aa-section-note">
                  Continue below to finish signing in. This page is safe for email scanners because
                  it does not consume the link until you submit the form.
                </p>
              </div>
              <form method="post" action="/auth/verify">
                <input type="hidden" name="token" value={token} />
                <ButtonRow>
                  <Button variant="primary" type="submit">
                    Continue
                  </Button>
                  <Button variant="secondary" href="/login?mode=magic">
                    Send a new link
                  </Button>
                </ButtonRow>
              </form>
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

/**
 * Rendered whenever a sign-in link cannot be consumed. That is three states, not one: the token was
 * already used, it timed out, or it never existed. `consumeMagicLink` can tell them apart, and this
 * page deliberately does not.
 *
 * The remedy is identical in all three cases, so naming the cause buys the reader nothing. It costs
 * something, though: the screen before this one promises that the confirmation "is identical for
 * known and unknown addresses", and telling a visitor whether a token was ever real would contradict
 * a promise this flow makes out loud. Naming a cause would also put us back where A-38 was, since a
 * fabricated token would have to be labelled "used" or "expired" and it is neither.
 */
export function MagicLinkInvalidPage({ email = '' }: { email?: string }) {
  return (
    <Layout
      title="Sign-in link · Agent Artifacts"
      description="This sign-in link can no longer be used."
    >
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">Sign-in link</p>
                <h1 class="aa-section-title">That sign-in link is no longer valid.</h1>
                <p class="aa-section-note">
                  Sign-in links are single-use and last 15 minutes, so this one has either been used
                  already or timed out. Send yourself a fresh link to continue.
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
              <form method="post" action="/auth/change-email">
                <input type="hidden" name="token" value={token} />
                <ButtonRow>
                  <Button variant="primary" type="submit">
                    Update email
                  </Button>
                  <Button variant="secondary" href="/dashboard/settings">
                    Back to settings
                  </Button>
                </ButtonRow>
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

/**
 * The sent state owns its whole header. It carries the page's only h1, and its status rides the
 * heading row rather than floating in a stack gap above it.
 */
function MagicLinkSentCard({ email }: { email: string }) {
  return (
    <section class="aa-stack" aria-live="polite">
      <div>
        <ProductMark />
        <p class="aa-page-kicker">Human dashboard</p>
        <StatusHeading level={1} status="Link sent" tone="success">
          Check your email
        </StatusHeading>
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
