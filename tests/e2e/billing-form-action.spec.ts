import { expect, test } from '@playwright/test';

/**
 * THE ONE TEST THAT COULD HAVE CAUGHT THE OUTAGE, RUN IN A BROWSER THAT ENFORCES THE POLICY.
 *
 * `form-action` is enforced by the browser and by nothing else. The server-side suite POSTs to
 * `/dashboard/api/billing/checkout` and asserts the 303 and its `Location`, which the server
 * produces perfectly while every real upgrade fails — so those tests stayed green straight through
 * an outage that stopped all revenue. The gap is not that they were weak; it is that no
 * request-level test can watch a browser refuse to follow a redirect. Only a browser can.
 *
 * ── WHAT IS REAL HERE AND WHAT IS STAGED ─────────────────────────────────────────────────────
 *
 * REAL: the policy. The CSP header is read off a live response from the running app rather than
 * written out here, so this spec cannot pass against a policy that would fail in production. Were
 * it retyped locally, the test would only be checking its own copy — which is the exact mistake
 * that let `form-action 'self'` look correct to its author.
 *
 * REAL: the enforcement, and the redirect chain that triggers it. A genuine form is submitted in
 * Chromium, the answer is a genuine 303 to a `checkout.stripe.com` URL, and the browser decides on
 * its own whether to follow it.
 *
 * STAGED: the two endpoints. Reaching the real checkout route needs a signed-in account with
 * billing configured and a Stripe secret key, and CI has none — the e2e servers start with no
 * Stripe env at all, so the billing card does not even render. Staging the hop keys this spec to
 * the mechanism that broke rather than to a Stripe fixture, so it runs on every push instead of
 * only where a key happens to exist. Status and target match `src/billing/routes.ts`.
 *
 * ── WHY THE ASSERTION IS "A REQUEST WAS MADE" ────────────────────────────────────────────────
 *
 * CSP blocks a form submission BEFORE any request is issued. So "did a request to
 * checkout.stripe.com leave the renderer" is exactly the question `form-action` decides, and it is
 * the whole assertion. Nothing needs to answer that request.
 *
 * Which is just as well, because nothing can intercept it: `page.route` does not see this hop.
 * Playwright treats a redirect as part of the ORIGINAL request's chain, so the handler that
 * fulfilled the 303 owns the redirect too and no handler is consulted for the new URL. An earlier
 * draft of this spec stubbed `checkout.stripe.com`, and the stub was silently ignored — the test
 * loaded the real Stripe Checkout over the network on every run, complete with `js.stripe.com`
 * assets and a beacon to `r.stripe.com`. It passed, so nothing drew attention to it.
 *
 * `--host-resolver-rules` closes that off one layer below Playwright: the hostname resolves to a
 * dead local port, so the renderer still ISSUES the request — which is all CSP governs, and all
 * this test reads — and the connection is refused before a byte reaches the network. The suite
 * stays hermetic and offline. `ERR_CONNECTION_REFUSED` is therefore the SUCCESS path here, and it
 * is asserted rather than tolerated: it is what distinguishes "the browser tried" from "the
 * browser was blocked", which is the entire distinction under test.
 *
 * WHAT WOULD STILL SLIP PAST: this proves the served policy permits the Stripe hop. It does not
 * prove Stripe's hosts are still the ones named — if Stripe moved Checkout, or a custom domain
 * were configured on the account, this stays green and production breaks. That is a live-config
 * fact no offline test can hold down; the hosts are pinned, with the evidence for them, in
 * `tests/integration/billing-form-action-csp.test.ts`.
 */

const PROBE_PAGE = '/__form-action-probe';
const PROBE_POST = '/__form-action-probe/checkout';
const STRIPE_CHECKOUT_HOST = 'checkout.stripe.com';
const STRIPE_REDIRECT = `https://${STRIPE_CHECKOUT_HOST}/c/pay/cs_test_probe`;

// Resolve the Stripe host to a closed local port for this file only. Requests are still issued;
// they simply cannot reach anything. See the note above on why interception cannot do this job.
test.use({
  launchOptions: { args: [`--host-resolver-rules=MAP ${STRIPE_CHECKOUT_HOST} 127.0.0.1:1`] },
});

test.describe('form-action lets a billing POST redirect to Stripe', () => {
  test('a submitted form follows the 303 to Checkout instead of being blocked', async ({
    page,
  }) => {
    // Chromium reports a blocked submission as a console error rather than a
    // `securitypolicyviolation` event — the same line the founder pasted out of the production
    // console. Captured so a regression names the directive instead of timing out silently.
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    const failures: string[] = [];
    page.on('requestfailed', (request) => {
      failures.push(`${request.url()} :: ${request.failure()?.errorText ?? 'unknown'}`);
    });

    // 1. The REAL policy, off a real response from the running app.
    const live = await page.goto('/login');
    const csp = live?.headers()['content-security-policy'];
    // A throw rather than an expect: everything below is meaningless without a real policy to
    // serve, so this fails the test AND narrows the type for the header used further down.
    if (!csp) throw new Error('the app served no Content-Security-Policy on /login');
    expect(csp, 'sanity: this spec is about form-action').toContain('form-action');

    // 2. A page on the app origin carrying that policy, with the same shape of form the settings
    //    page renders: POST, same-origin action, no Stripe URL anywhere in the markup.
    await page.route(`**${PROBE_PAGE}`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp },
        body: `<!doctype html><meta charset="utf-8"><title>probe</title>
          <form id="upgrade" method="post" action="${PROBE_POST}">
            <input type="hidden" name="interval" value="monthly">
            <button type="submit">Upgrade to Pro</button>
          </form>`,
      })
    );

    // 3. Our handler's answer, the shape src/billing/routes.ts produces: 303 to Stripe.
    await page.route(`**${PROBE_POST}`, (route) =>
      route.fulfill({ status: 303, headers: { location: STRIPE_REDIRECT } })
    );

    await page.goto(PROBE_PAGE);

    // Listen before clicking: under the fixed policy the request is issued immediately.
    const stripeRequest = page
      .waitForRequest((request) => new URL(request.url()).hostname === STRIPE_CHECKOUT_HOST, {
        timeout: 10_000,
      })
      .then((request) => request.url())
      .catch(() => null);

    await page.click('#upgrade button[type=submit]');
    const requested = await stripeRequest;

    expect(
      requested,
      `The browser issued no request to ${STRIPE_CHECKOUT_HOST} — the submission was blocked.\n` +
        `Console: ${consoleErrors.join('\n         ') || '(none)'}\n` +
        `Served policy: ${csp}\n` +
        `This is the production defect: form-action is applied to every hop of the redirect ` +
        `chain, so posting same-origin does not exempt the Stripe hop.`
    ).toBe(STRIPE_REDIRECT);

    // No CSP complaint anywhere: a policy that allowed the hop but tripped on something else would
    // otherwise pass the assertion above while still being broken in a browser.
    expect(
      consoleErrors.filter((line) => /form-action|Content Security Policy/i.test(line)),
      'no CSP complaint should be reported for the submission'
    ).toEqual([]);

    // The request was ISSUED and then refused by the resolver stub — proof it left the renderer
    // under its own steam rather than being stopped by policy. If this ever reports something
    // other than a connection failure, the host mapping above has stopped working and the suite is
    // quietly talking to the real Stripe again.
    await expect
      .poll(() => failures.filter((entry) => entry.includes(STRIPE_CHECKOUT_HOST)), {
        timeout: 5_000,
        message: 'expected the Stripe navigation to be refused by the local resolver stub',
      })
      .toEqual([`${STRIPE_REDIRECT} :: net::ERR_CONNECTION_REFUSED`]);
  });
});
