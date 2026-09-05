import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

/**
 * `form-action` IS CHECKED AGAINST EVERY HOP, NOT JUST THE POST TARGET.
 *
 * The upgrade button posts to `/dashboard/api/billing/checkout` — same origin, which `'self'`
 * permits — and that handler answers 303 to a `checkout.stripe.com` URL. Chrome applies
 * `form-action` to the redirect as well as to the original submission, so `form-action 'self'`
 * blocks the Stripe hop and the whole submission fails with:
 *
 *   Sending form data to 'https://agentartifact.ai/dashboard/api/billing/checkout' violates the
 *   following Content Security Policy directive: "form-action 'self'".
 *
 * That shipped, and it took paid upgrades and the billing portal down together.
 *
 * WHY THIS TEST EXISTS RATHER THAN AN ENDPOINT TEST. The suite already had tests that POST to the
 * checkout route and assert the 303 and its `Location`. Every one of them passed throughout the
 * outage, and they had to: the server does answer 303, correctly, with the right URL. The part that
 * fails is the browser declining to follow it, which no server-side request can observe. A test
 * that exercises the endpoint will be green while the feature is dead, so the policy itself has to
 * be asserted directly.
 *
 * THE HOSTS BELOW ARE LITERALS ON PURPOSE. Importing the same constant the CSP is built from would
 * assert only that a string equals itself. These were read off the Stripe API — both test mode and
 * the live account — rather than taken from the docs: `checkout.sessions.create().url` is on
 * `https://checkout.stripe.com` and `billingPortal.sessions.create().url` is on
 * `https://billing.stripe.com`.
 *
 * IF STRIPE CUSTOM DOMAINS ARE EVER TURNED ON, these hosts change to your own
 * (`checkout.example.com`), this allowance stops covering them, and payments break in exactly this
 * way again. Neither the live nor the test account has one configured today. Making the hosts
 * configurable is the fix at that point — not widening the directive.
 */
const STRIPE_CHECKOUT_ORIGIN = 'https://checkout.stripe.com';
const STRIPE_PORTAL_ORIGIN = 'https://billing.stripe.com';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'aa-form-action-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function testApp() {
  const config = loadConfig(
    {
      DEPLOYMENT: 'self-hosted',
      BASE_URL: 'https://example.test',
      AA_SQLITE_PATH: './data/app.db',
    },
    { cwd }
  );
  return createApp({ config, logger: pino({ enabled: false }) });
}

/** The `form-action` values actually served on an app-origin page, read off a real response. */
async function servedFormAction(path = '/login'): Promise<string[]> {
  const response = await testApp().request(`https://example.test${path}`);
  const csp = response.headers.get('content-security-policy');
  if (!csp) throw new Error(`no CSP header on ${path}`);

  const directive = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part === 'form-action' || part.startsWith('form-action '));
  if (!directive) throw new Error(`no form-action directive in: ${csp}`);

  return directive.split(/\s+/).slice(1);
}

describe('form-action survives the redirect to Stripe', () => {
  it('permits the Checkout host the upgrade form is redirected to', async () => {
    expect(await servedFormAction()).toContain(STRIPE_CHECKOUT_ORIGIN);
  });

  it('permits the billing portal host the manage-subscription form is redirected to', async () => {
    // A second host, and a second broken flow. `checkout.stripe.com` alone fixes the upgrade
    // button and leaves "Manage billing" dead, which is the half-fix this asserts against.
    expect(await servedFormAction()).toContain(STRIPE_PORTAL_ORIGIN);
  });

  it('still allows our own origin, so the POST itself is not blocked', async () => {
    // The first hop is same-origin. Dropping `'self'` while adding Stripe would block the
    // submission one step earlier and look like the very bug being fixed here.
    expect(await servedFormAction()).toContain("'self'");
  });

  it('carries the allowance on every app-origin page, not just the one sampled above', async () => {
    // The policy is applied by one middleware to the whole app origin, so a page-by-page check
    // would be theatre. What is worth pinning is that the allowance travels with that middleware
    // rather than being attached to a single route: the dashboard is where the billing forms are
    // rendered, and it is served by the same handler chain as these.
    for (const path of ['/login', '/setup', '/style-guide']) {
      const values = await servedFormAction(path);
      expect(values, `form-action on ${path}`).toContain(STRIPE_CHECKOUT_ORIGIN);
      expect(values, `form-action on ${path}`).toContain(STRIPE_PORTAL_ORIGIN);
    }
  });

  it('names two exact hosts and widens no further', async () => {
    // The lazy repair for this outage is `form-action https:` or a `*.stripe.com` wildcard, both of
    // which re-open form submission to anywhere and would pass every assertion above.
    const values = await servedFormAction();

    expect(values).toEqual(["'self'", STRIPE_CHECKOUT_ORIGIN, STRIPE_PORTAL_ORIGIN]);
    expect(values).not.toContain('https:');
    expect(values.some((value) => value.includes('*'))).toBe(false);
  });
});
