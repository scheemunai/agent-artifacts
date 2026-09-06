import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { Hono } from 'hono';
import pino from 'pino';
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BillingModule } from '../../src/billing/module.js';
import { registerStripeWebhookRoute } from '../../src/billing/routes.js';
import {
  accessEndsAt,
  type BillingState,
  BillingStore,
  isCancellationScheduled,
} from '../../src/billing/store.js';
import { handleStripeEvent } from '../../src/billing/webhook.js';
import type { BillingConfig } from '../../src/config.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Logger } from '../../src/logger.js';

const WEBHOOK_SECRET = 'whsec_test_secret_for_signature_verification';
const PRICE_MONTHLY = 'price_test_monthly';
const PRICE_ANNUAL = 'price_test_annual';
const ACCOUNT_ID = 'acc_billing_test';
const CUSTOMER_ID = 'cus_test_123';
const SUBSCRIPTION_ID = 'sub_test_123';

const billingConfig: BillingConfig = {
  secretKey: 'sk_test_dummy',
  webhookSecret: WEBHOOK_SECRET,
  priceProMonthly: PRICE_MONTHLY,
  priceProAnnual: PRICE_ANNUAL,
  freeRetentionDays: 7,
  retentionEnforcementEnabled: false,
};

function silentLogger(): Logger {
  return pino(
    { level: 'error' },
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    })
  ) as unknown as Logger;
}

/** Sign a payload exactly the way Stripe does, so `constructEvent` accepts it. */
function stripeSignature(payload: string, secret = WEBHOOK_SECRET, timestamp = 1_800_000_000) {
  const signed = `${timestamp}.${payload}`;
  const signature = createHmac('sha256', secret).update(signed).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function subscriptionEvent(options: {
  id: string;
  type: string;
  created: number;
  status: string;
  priceId?: string;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number | null;
  periodEnd?: number;
}) {
  return {
    id: options.id,
    object: 'event',
    api_version: '2026-08-26.dahlia',
    created: options.created,
    type: options.type,
    data: {
      object: {
        id: SUBSCRIPTION_ID,
        object: 'subscription',
        customer: CUSTOMER_ID,
        status: options.status,
        cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
        cancel_at: options.cancelAt ?? null,
        metadata: { account_id: ACCOUNT_ID },
        items: {
          object: 'list',
          data: [
            {
              id: 'si_test',
              object: 'subscription_item',
              price: { id: options.priceId ?? PRICE_MONTHLY, object: 'price' },
              current_period_end: options.periodEnd ?? 1_800_100_000,
            },
          ],
        },
      },
    },
  };
}

describe('stripe webhook', () => {
  let cwd: string;
  let db: SqliteDatabaseHandle;
  let store: BillingStore;
  let logger: Logger;
  let stripe: Stripe;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'aa-stripe-'));
    logger = silentLogger();
    db = (await initializeDatabase(
      {
        sqlitePath: join(cwd, 'app.db'),
        dataDir: cwd,
      } as never,
      logger
    )) as SqliteDatabaseHandle;
    await runMigrations(db, logger);

    const now = Date.now();
    db.sqlite
      .prepare(
        `INSERT INTO accounts (id, email, plan, stripe_customer_id, created_at, updated_at)
         VALUES (?, ?, 'free', ?, ?, ?)`
      )
      .run(ACCOUNT_ID, 'billing@example.test', CUSTOMER_ID, now, now);

    store = new BillingStore(db);
    stripe = new Stripe('sk_test_dummy', { apiVersion: '2026-08-26.dahlia' });
  });

  afterEach(async () => {
    await db.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  function deps() {
    return {
      store,
      stripe,
      prices: { monthly: PRICE_MONTHLY, annual: PRICE_ANNUAL },
      logger,
    };
  }

  async function planOf(): Promise<string> {
    const state = await store.findByAccountId(ACCOUNT_ID);
    return state?.plan ?? 'missing';
  }

  it('grants pro on an active subscription for a known price', async () => {
    const event = subscriptionEvent({
      id: 'evt_1',
      type: 'customer.subscription.created',
      created: 1_800_000_100,
      status: 'active',
    });

    const outcome = await handleStripeEvent(event as never, deps());

    expect(outcome.status).toBe('applied');
    expect(await planOf()).toBe('pro');
  });

  it('is idempotent: replaying the same event id applies once', async () => {
    const event = subscriptionEvent({
      id: 'evt_dup',
      type: 'customer.subscription.created',
      created: 1_800_000_100,
      status: 'active',
    });

    const first = await handleStripeEvent(event as never, deps());
    const second = await handleStripeEvent(event as never, deps());

    expect(first.status).toBe('applied');
    expect(second.status).toBe('duplicate');

    const rows = db.sqlite
      .prepare('SELECT COUNT(*) AS c FROM stripe_events WHERE id = ?')
      .get('evt_dup') as { c: number };
    expect(rows.c).toBe(1);
  });

  it('drops a stale event that arrives after a newer one', async () => {
    // Cancellation lands first...
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_late_delete',
        type: 'customer.subscription.deleted',
        created: 1_800_000_500,
        status: 'canceled',
      }) as never,
      deps()
    );
    expect(await planOf()).toBe('free');

    // ...then a DELAYED "active" update from earlier in time shows up. It must not resurrect Pro.
    const outcome = await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_early_update',
        type: 'customer.subscription.updated',
        created: 1_800_000_100,
        status: 'active',
      }) as never,
      deps()
    );

    expect(outcome.status).toBe('stale');
    expect(await planOf()).toBe('free');
  });

  it('keeps pro access on past_due rather than downgrading mid-retry', async () => {
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_active',
        type: 'customer.subscription.created',
        created: 1_800_000_100,
        status: 'active',
      }) as never,
      deps()
    );

    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_pastdue',
        type: 'customer.subscription.updated',
        created: 1_800_000_200,
        status: 'past_due',
      }) as never,
      deps()
    );

    const state = await store.findByAccountId(ACCOUNT_ID);
    expect(state?.subscriptionStatus).toBe('past_due');
    expect(state?.plan).toBe('pro');
  });

  it('downgrades to free once the subscription is deleted', async () => {
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_a',
        type: 'customer.subscription.created',
        created: 1_800_000_100,
        status: 'active',
      }) as never,
      deps()
    );
    expect(await planOf()).toBe('pro');

    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_b',
        type: 'customer.subscription.deleted',
        created: 1_800_000_300,
        status: 'canceled',
      }) as never,
      deps()
    );

    const state = await store.findByAccountId(ACCOUNT_ID);
    expect(state?.plan).toBe('free');
    expect(state?.stripeSubscriptionId).toBeNull();
  });

  it('never grants pro for an unrecognised price id', async () => {
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_unknown_price',
        type: 'customer.subscription.created',
        created: 1_800_000_100,
        status: 'active',
        priceId: 'price_someone_elses',
      }) as never,
      deps()
    );

    expect(await planOf()).toBe('free');
  });

  it('records cancel_at_period_end without removing access', async () => {
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_cancelling',
        type: 'customer.subscription.updated',
        created: 1_800_000_100,
        status: 'active',
        cancelAtPeriodEnd: true,
      }) as never,
      deps()
    );

    const state = await store.findByAccountId(ACCOUNT_ID);
    expect(state?.plan).toBe('pro');
    expect(state?.cancelAtPeriodEnd).toBe(true);
    // The boolean alone still counts as scheduled. It is the path Stripe uses when a cancellation
    // carries no explicit instant, and it must keep working now that a second field is read too.
    expect(isCancellationScheduled(state as BillingState)).toBe(true);
    expect(accessEndsAt(state as BillingState)).toBe(1_800_100_000_000);
  });

  it('records a cancel_at that Stripe set WITHOUT cancel_at_period_end', async () => {
    // The billing-portal shape, in miniature. The real payload it was found in is replayed in
    // tests/integration/stripe-live-cancellation.test.ts; this asserts the mapping directly.
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_cancel_at_only',
        type: 'customer.subscription.updated',
        created: 1_800_000_100,
        status: 'active',
        cancelAtPeriodEnd: false,
        cancelAt: 1_800_100_000,
      }) as never,
      deps()
    );

    const state = await store.findByAccountId(ACCOUNT_ID);
    expect(state?.plan).toBe('pro');
    // Stripe's own flag is cached verbatim — false, because that is what Stripe sent.
    expect(state?.cancelAtPeriodEnd).toBe(false);
    expect(state?.cancelAt).toBe(1_800_100_000_000);
    expect(isCancellationScheduled(state as BillingState)).toBe(true);
  });

  it('does not leave a cancellation date on a subscription that has already ended', async () => {
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_scheduled',
        type: 'customer.subscription.updated',
        created: 1_800_000_100,
        status: 'active',
        cancelAt: 1_800_100_000,
      }) as never,
      deps()
    );
    expect((await store.findByAccountId(ACCOUNT_ID))?.cancelAt).toBe(1_800_100_000_000);

    // Stripe keeps sending `cancel_at` on the final `deleted` event. Nothing is scheduled any more,
    // and a leftover future date would read as an end that has not happened yet.
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_now_gone',
        type: 'customer.subscription.deleted',
        created: 1_800_000_400,
        status: 'canceled',
        cancelAt: 1_800_100_000,
      }) as never,
      deps()
    );

    const state = await store.findByAccountId(ACCOUNT_ID);
    expect(state?.plan).toBe('free');
    expect(state?.cancelAt).toBeNull();
    expect(isCancellationScheduled(state as BillingState)).toBe(false);
  });

  it('an invoice does not erase a cancellation that is already scheduled', async () => {
    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_sched_then_invoice',
        type: 'customer.subscription.updated',
        created: 1_800_000_100,
        status: 'active',
        cancelAt: 1_800_100_000,
      }) as never,
      deps()
    );

    // `applySubscription` writes every column in its SET list, so an invoice handler that did not
    // carry these through would quietly un-cancel the subscription.
    await handleStripeEvent(
      {
        id: 'evt_invoice_after_cancel',
        object: 'event',
        created: 1_800_000_200,
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_after_cancel',
            object: 'invoice',
            customer: CUSTOMER_ID,
            lines: { object: 'list', data: [{ period: { end: 1_800_200_000 } }] },
          },
        },
      } as never,
      deps()
    );

    const state = await store.findByAccountId(ACCOUNT_ID);
    expect(state?.cancelAt).toBe(1_800_100_000_000);
    expect(isCancellationScheduled(state as BillingState)).toBe(true);
  });

  it('acknowledges an unhandled event type without touching state', async () => {
    const outcome = await handleStripeEvent(
      {
        id: 'evt_unrelated',
        object: 'event',
        created: 1_800_000_100,
        type: 'payout.created',
        data: { object: { id: 'po_1', object: 'payout' } },
      } as never,
      deps()
    );

    expect(outcome.status).toBe('ignored');
    expect(await planOf()).toBe('free');
  });

  it('leaves a comped account on pro even when Stripe cancels', async () => {
    await store.setCompPlan(ACCOUNT_ID, 'pro', Date.now());

    await handleStripeEvent(
      subscriptionEvent({
        id: 'evt_cancel_comped',
        type: 'customer.subscription.deleted',
        created: 1_800_000_300,
        status: 'canceled',
      }) as never,
      deps()
    );

    const module = new BillingModule({ db, config: billingConfig, logger, stripe });
    const plan = await module.resolvePlan({
      id: ACCOUNT_ID,
      email: 'billing@example.test',
      suspendedAt: null,
    });

    // The stored Stripe-derived plan went to free, but the operator grant still wins.
    expect((await store.findByAccountId(ACCOUNT_ID))?.plan).toBe('free');
    expect(plan.id).toBe('pro');
    expect(plan.showFooter).toBe(false);
  });

  describe('HTTP route', () => {
    function appWithWebhook() {
      const app = new Hono();
      registerStripeWebhookRoute(app as never, {
        billing: billingConfig,
        store,
        stripe,
        logger,
      });
      return app;
    }

    it('rejects a request with no signature header', async () => {
      const response = await appWithWebhook().request('/stripe/webhook', {
        method: 'POST',
        body: JSON.stringify({ id: 'evt_x' }),
      });
      expect(response.status).toBe(400);
    });

    it('rejects a forged signature and changes nothing', async () => {
      const payload = JSON.stringify(
        subscriptionEvent({
          id: 'evt_forged',
          type: 'customer.subscription.created',
          created: 1_800_000_100,
          status: 'active',
        })
      );

      const response = await appWithWebhook().request('/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': stripeSignature(payload, 'whsec_the_wrong_secret') },
        body: payload,
      });

      expect(response.status).toBe(400);
      // The whole point: an unverified event must never reach the entitlement path.
      expect(await planOf()).toBe('free');
    });

    /**
     * THE RAW-BODY REGRESSION GUARD.
     *
     * Stripe's signature is an HMAC over the exact bytes it sent, so any global body-parsing
     * middleware that parses and re-serialises the request would invalidate every signature and take
     * billing down silently — the endpoint would 400 on genuine events and nobody would notice until
     * a customer complained that they paid and got nothing.
     *
     * This test signs a payload with non-canonical JSON formatting (extra whitespace, unusual key
     * order). A round trip through JSON.parse/stringify would normalise it and break the HMAC, so
     * this only passes while the route reads the untouched body.
     */
    it('verifies against the exact received bytes, not a re-serialised body', async () => {
      const event = subscriptionEvent({
        id: 'evt_raw_bytes',
        type: 'customer.subscription.created',
        created: 1_800_000_100,
        status: 'active',
      });
      // Pretty-printed: semantically identical, byte-wise very different.
      const payload = JSON.stringify(event, null, 2);
      expect(payload).not.toBe(JSON.stringify(event));

      const response = await appWithWebhook().request('/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': stripeSignature(payload) },
        body: payload,
      });

      expect(response.status).toBe(200);
      expect(await planOf()).toBe('pro');
    });

    it('accepts a correctly signed event and applies it', async () => {
      const payload = JSON.stringify(
        subscriptionEvent({
          id: 'evt_signed_ok',
          type: 'customer.subscription.created',
          created: 1_800_000_100,
          status: 'active',
        })
      );

      const response = await appWithWebhook().request('/stripe/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': stripeSignature(payload) },
        body: payload,
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ received: true, outcome: 'applied' });
      expect(await planOf()).toBe('pro');
    });
  });
});
