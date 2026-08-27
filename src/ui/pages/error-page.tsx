import { Layout } from '../components/layout.js';
import { Button, ButtonRow, Card, NavShell, ProductMark } from '../components/primitives.js';

/**
 * The branded answer to a request that missed.
 *
 * Every miss used to return the API's own body, so a signed-in owner following a stale artifact
 * link, a reader opening an expired download and anyone hitting a removed asset all landed on
 * `{"error":{"code":"not_found","message":"Not found"}}` in the browser's JSON viewer — no chrome,
 * no explanation, no way back. This page is what a browser gets instead; API clients keep the
 * envelope untouched, decided by the caller's `Accept` header in the global error handler.
 *
 * The chrome follows the visitor, not the route: a signed-in owner keeps the dashboard navigation
 * they were using, so a dead link is a detour rather than an ejection. Everyone else gets the
 * plain public card.
 */
export type ErrorPageChrome = 'dashboard' | 'public';

export interface ErrorPageProps {
  status: number;
  code: string;
  chrome: ErrorPageChrome;
  requestId?: string | undefined;
}

interface ErrorCopy {
  kicker: string;
  title: string;
  message: string;
}

export function ErrorPage({ status, code, chrome, requestId }: ErrorPageProps) {
  const copy = errorCopy(status, code);
  const action =
    chrome === 'dashboard'
      ? { href: '/dashboard', label: 'Back to your artifacts' }
      : { href: '/', label: 'Go to Agent Artifacts' };

  return (
    <Layout title={`${copy.title} · Agent Artifacts`} description={copy.message}>
      {chrome === 'dashboard' ? (
        <NavShell
          items={[
            { label: 'Artifacts', href: '/dashboard' },
            { label: 'Bots', href: '/dashboard/bots' },
            { label: 'Templates', href: '/dashboard/templates' },
            { label: 'Settings', href: '/dashboard/settings' },
          ]}
        />
      ) : null}
      <main class="aa-placeholder">
        <div class="aa-shell aa-shell--narrow">
          <Card raised>
            <div class="aa-stack aa-placeholder-card">
              <div>
                <ProductMark />
                <p class="aa-page-kicker">{copy.kicker}</p>
                <h1 class="aa-section-title">{copy.title}</h1>
                <p class="aa-section-note">{copy.message}</p>
              </div>
              <ButtonRow>
                <Button variant="primary" href={action.href}>
                  {action.label}
                </Button>
              </ButtonRow>
              {requestId ? (
                <p class="aa-hint">
                  Quote this reference if you get in touch: <code>{requestId}</code>
                </p>
              ) : null}
            </div>
          </Card>
        </div>
      </main>
    </Layout>
  );
}

/**
 * One sentence that says what happened, in the reader's language. Never a bare status code, and
 * never the same string twice on one page.
 */
function errorCopy(status: number, code: string): ErrorCopy {
  if (status === 401 || status === 403) {
    return {
      kicker: 'No access',
      title: 'You cannot open this page',
      message:
        'It belongs to a different account, or your session has ended. Sign in with the account that owns it and try again.',
    };
  }

  if (status === 410) {
    return {
      kicker: 'Gone',
      title: 'This is no longer available',
      message: 'The owner removed it, or it reached the end of its retention window.',
    };
  }

  if (status === 429 || code === 'rate_limited') {
    return {
      kicker: 'Slow down',
      title: 'Too many requests',
      message: 'Wait a moment and try again. Nothing was lost.',
    };
  }

  if (status >= 500) {
    return {
      kicker: 'Our fault',
      title: 'Something went wrong on our side',
      message: 'The request did not complete. Try again in a moment.',
    };
  }

  if (status === 404) {
    return {
      kicker: 'Missing page',
      title: 'Not found',
      message:
        'The page you asked for is not here. It may have been removed, or the link may be wrong.',
    };
  }

  return {
    kicker: 'Request failed',
    title: 'That request could not be completed',
    message: 'Check the address and try again.',
  };
}
