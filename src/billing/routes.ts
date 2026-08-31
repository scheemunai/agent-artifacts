import type { Hono } from 'hono';
import Stripe from 'stripe';
import type { AppConfig, BillingConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { type BillingInterval, isBillingInterval } from './plans.js';
import type { BillingStore } from './store.js';
import { handleStripeEvent } from './webhook.js';

/** Where the dashboard sends people back to after Stripe. */
export const BILLING_RETURN_PATH = '/dashboard/settings';

export function createStripeClient(billing: BillingConfig): Stripe {
  return new Stripe(billing.secretKey, {
    // Pinning is deliberate: an account-level API version change should not be able to alter the
    // shape of the objects this code reads without a deploy.
    apiVersion: '2026-08-26.dahlia',
    typescript: true,
    maxNetworkRetries: 2,
  });
}

export interface WebhookRouteContext {
  billing: BillingConfig;
  store: BillingStore;
  stripe: Stripe;
  logger: Logger;
}

/**
 * `POST /stripe/webhook`.
 *
 * Mounted at the app root, NOT under `/v1`, and that placement is load-bearing: the rate limiter is
 * registered inside `registerV1Routes` and scoped to `/v1/*`, so this path is naturally exempt.
 * Throttling Stripe's retries would silently drop billing events — the failure mode being avoided
 * is "customer paid, app never noticed".
 *
 * It is also the one route in the app with no session and no API key. The signature IS the
 * authentication.
 */
export function registerStripeWebhookRoute(app: Hono<never>, ctx: WebhookRouteContext): void {
  app.post('/stripe/webhook', async (context) => {
    const signature = context.req.header('stripe-signature');
    if (!signature) {
      return context.json({ error: { code: 'missing_signature' } }, 400);
    }

    // RAW BYTES. `c.req.text()` is what makes signature verification possible: the HMAC is computed
    // over the exact payload Stripe sent, so any parse-then-restringify — including a global JSON
    // body parser added later — invalidates every signature. This app deliberately has no global
    // body-parsing middleware; `tests/integration/stripe-webhook.test.ts` guards that.
    const rawBody = await context.req.text();

    let event: Stripe.Event;
    try {
      event = ctx.stripe.webhooks.constructEvent(rawBody, signature, ctx.billing.webhookSecret);
    } catch (error) {
      // An unverified event must never reach the entitlement path. Without this check the endpoint
      // reads "anyone on the internet may grant themselves Pro".
      ctx.logger.warn({ err: error }, 'billing.webhook.signature_invalid');
      return context.json({ error: { code: 'invalid_signature' } }, 400);
    }

    try {
      const outcome = await handleStripeEvent(event, {
        store: ctx.store,
        stripe: ctx.stripe,
        prices: { monthly: ctx.billing.priceProMonthly, annual: ctx.billing.priceProAnnual },
        logger: ctx.logger,
      });
      return context.json({ received: true, outcome: outcome.status }, 200);
    } catch (error) {
      // A 500 tells Stripe to retry, which is the right answer for a transient database failure.
      ctx.logger.error(
        { err: error, event_id: event.id, type: event.type },
        'billing.webhook.failed'
      );
      return context.json({ error: { code: 'webhook_processing_failed' } }, 500);
    }
  });
}

export interface BillingDashboardContext {
  config: AppConfig;
  billing: BillingConfig;
  store: BillingStore;
  stripe: Stripe;
  logger: Logger;
  /**
   * Returns the signed-in account, or null. Supplied by the dashboard's SessionService.
   *
   * Typed loosely because Hono's Context carries per-route generics that do not survive being
   * handed across module boundaries; this seam only ever reads the request cookie.
   */
  // biome-ignore lint/suspicious/noExplicitAny: Hono Context generics differ per mounted route.
  resolveAccount: (context: any) => Promise<{ id: string; email: string } | null>;
}

/**
 * The two session-authenticated billing endpoints.
 *
 * Registered from `registerHumanRoutes` alongside the rest of `/dashboard/api/*`, so they share the
 * dashboard's session machinery rather than reimplementing it.
 */
export function registerBillingDashboardRoutes(
  app: Hono<never>,
  ctx: BillingDashboardContext
): void {
  /**
   * `POST /dashboard/api/billing/checkout` — start an upgrade.
   *
   * The browser POSTs HERE, never directly to Stripe: the app's CSP sets `form-action 'self'`, so a
   * form targeting checkout.stripe.com would be blocked by the browser outright. Server-side is also
   * what keeps price selection authoritative — the client sends an INTERVAL, not a price id, so a
   * tampered form cannot subscribe someone to a price of their own choosing.
   */
  app.post('/dashboard/api/billing/checkout', async (context) => {
    const account = await ctx.resolveAccount(context);
    if (!account) {
      return context.redirect('/login', 303);
    }

    const state = await ctx.store.findByAccountId(account.id);
    if (!state) {
      return context.redirect(`${BILLING_RETURN_PATH}?billing=error`, 303);
    }

    const form = await context.req.parseBody();
    const interval: BillingInterval = isBillingInterval(form.interval) ? form.interval : 'monthly';
    const priceId =
      interval === 'annual' ? ctx.billing.priceProAnnual : ctx.billing.priceProMonthly;

    try {
      const customerId = await ensureCustomer(state.stripeCustomerId, {
        accountId: account.id,
        email: state.email,
        stripe: ctx.stripe,
        store: ctx.store,
      });

      const session = await createCheckoutSession(ctx, {
        accountId: account.id,
        customerId,
        priceId,
        interval,
      });

      if (!session.url) {
        throw new Error('Stripe returned a Checkout Session without a URL');
      }
      return context.redirect(session.url, 303);
    } catch (error) {
      ctx.logger.error({ err: error, account_id: account.id }, 'billing.checkout.failed');
      return context.redirect(`${BILLING_RETURN_PATH}?billing=error`, 303);
    }
  });

  /**
   * `POST /dashboard/api/billing/portal` — self-serve cancel, plan switch, payment method.
   *
   * Everything the customer changes in there comes back to us as a webhook, which is precisely why
   * the portal is safe to hand over: there is nothing to poll and no return URL to parse.
   */
  app.post('/dashboard/api/billing/portal', async (context) => {
    const account = await ctx.resolveAccount(context);
    if (!account) {
      return context.redirect('/login', 303);
    }

    const state = await ctx.store.findByAccountId(account.id);
    if (!state?.stripeCustomerId) {
      // An account that has never started an upgrade has no Stripe customer, so there is nothing to
      // manage. Say so rather than 500ing on a portal session for a customer that does not exist.
      return context.redirect(`${BILLING_RETURN_PATH}?billing=no_customer`, 303);
    }

    try {
      const session = await ctx.stripe.billingPortal.sessions.create({
        customer: state.stripeCustomerId,
        return_url: `${ctx.config.baseUrl}${BILLING_RETURN_PATH}`,
      });
      return context.redirect(session.url, 303);
    } catch (error) {
      ctx.logger.error({ err: error, account_id: account.id }, 'billing.portal.failed');
      return context.redirect(`${BILLING_RETURN_PATH}?billing=error`, 303);
    }
  });
}

/**
 * Build the Checkout Session, with terms-of-service consent if the account can collect it.
 *
 * The two Stripe-account facts this has to survive:
 *
 * 1. MANAGED PAYMENTS is on, so `custom_text` is rejected outright ("custom_text cannot be used
 *    with Managed Payments"). The terms checkbox therefore uses Stripe's own wording pointing at
 *    the Dashboard-configured URL, rather than our sentence linking to /terms and /refund-policy.
 *    Those links live in the site footer and on the ToS page instead.
 *
 * 2. `consent_collection.terms_of_service` REQUIRES a Terms URL set in the Stripe Dashboard
 *    (Settings -> Public details), and that setting cannot be written through the API on a
 *    first-party account — I tried; it answers "you may only use it on connected accounts". So the
 *    integration cannot guarantee it is present.
 *
 * Which makes the fallback the important part. Sending `consent_collection` to an account without
 * the URL fails the session, and a failed session is a customer who cannot pay. So a miss is caught,
 * logged LOUDLY, and retried once without consent — checkout keeps working, and the gap is visible
 * in the logs instead of silently costing sales. It is deliberately not silent: dropping ToS
 * acceptance without saying so would be its own problem.
 */
async function createCheckoutSession(
  ctx: BillingDashboardContext,
  input: { accountId: string; customerId: string; priceId: string; interval: BillingInterval }
): Promise<Stripe.Checkout.Session> {
  const base: Stripe.Checkout.SessionCreateParams = {
    mode: 'subscription',
    customer: input.customerId,
    line_items: [{ price: input.priceId, quantity: 1 }],
    // Both directions of the link. `subscription_data.metadata` is the one that matters most: it
    // puts account_id on the SUBSCRIPTION, so every later customer.subscription.* event can be
    // resolved even if the customer lookup somehow fails.
    client_reference_id: input.accountId,
    subscription_data: { metadata: { account_id: input.accountId } },
    success_url: `${ctx.config.baseUrl}${BILLING_RETURN_PATH}?billing=success`,
    cancel_url: `${ctx.config.baseUrl}${BILLING_RETURN_PATH}?billing=cancelled`,
    allow_promotion_codes: true,

    // --- Stripe Tax ---------------------------------------------------------------------------
    // Set at session level, which is what carries it onto the subscription Checkout creates — so
    // every renewal invoice is taxed too, not just the first charge.
    automatic_tax: { enabled: true },
    // Tax cannot be computed without a location, so the address is REQUIRED rather than optional.
    // An EU seller of digital services owes VAT at the CUSTOMER's rate, so a missing address is not
    // a smaller tax bill — it is an uncomputable one.
    billing_address_collection: 'required',
    // B2B: a valid VAT number lets Stripe reverse-charge instead of adding VAT.
    tax_id_collection: { enabled: true },
    // REQUIRED when an existing `customer` is passed alongside automatic_tax. Without it Stripe
    // refuses the session — it will not write an address onto a customer record the integration
    // did not say it could modify.
    customer_update: { address: 'auto', name: 'auto' },
  };

  const idempotencyKey = `checkout:${input.accountId}:${input.customerId}:${input.interval}`;

  try {
    return await ctx.stripe.checkout.sessions.create(
      { ...base, consent_collection: { terms_of_service: 'required' } },
      // A double-clicked upgrade button must not create two subscriptions. Scoped to the account,
      // customer and interval so a genuine later change of plan still works.
      { idempotencyKey }
    );
  } catch (error) {
    if (!isMissingTermsUrlError(error)) {
      throw error;
    }
    ctx.logger.error(
      { account_id: input.accountId },
      'billing.checkout.tos_consent_unavailable: no Terms of Service URL is set in the Stripe Dashboard (Settings -> Public details), so checkout proceeded WITHOUT recording terms acceptance. Set the URL to /terms and this stops happening.'
    );
    return ctx.stripe.checkout.sessions.create(base, {
      // A different key: the first attempt consumed the original one, and reusing it would replay
      // the failure rather than creating the session.
      idempotencyKey: `${idempotencyKey}:no-tos`,
    });
  }
}

/** Stripe reports the missing Dashboard setting as a plain invalid_request, so match on the text. */
function isMissingTermsUrlError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /terms of service/i.test(error.message) &&
    /url is set|url in the stripe dashboard/i.test(error.message)
  );
}

/**
 * Reuse the account's Stripe customer, or mint one and persist it BEFORE the session is created.
 *
 * Persisting first is the whole point: if the user abandons Checkout, the customer is still linked
 * and the next attempt reuses it. Creating the session first and saving afterwards means every
 * abandoned attempt leaves an orphan customer and the account's billing history fragments across
 * several of them.
 */
async function ensureCustomer(
  existing: string | null,
  input: { accountId: string; email: string; stripe: Stripe; store: BillingStore }
): Promise<string> {
  if (existing) {
    return existing;
  }

  const customer = await input.stripe.customers.create(
    {
      email: input.email,
      metadata: { account_id: input.accountId },
    },
    { idempotencyKey: `customer:${input.accountId}` }
  );

  await input.store.setCustomerId(input.accountId, customer.id, Date.now());
  return customer.id;
}
