import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  accessEndsAt,
  type BillingState,
  BillingStore,
  isCancellationScheduled,
} from '../../src/billing/store.js';
import { handleStripeEvent } from '../../src/billing/webhook.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Logger } from '../../src/logger.js';
import { type DashboardBillingView, DashboardSettingsPage } from '../../src/ui/pages/dashboard.js';

/**
 * The bug this file exists for, in one line:
 *
 *   A customer cancelled through the Stripe billing portal, and the dashboard kept saying
 *   "Renews on 6 October 2026".
 *
 * Every other test in `stripe-webhook.test.ts` builds its subscription with a helper that sets
 * `cancel_at_period_end` by hand, so they all agree with the mapping and none of them could ever
 * have caught this. These are Stripe's own bytes, replayed in the order Stripe delivered them, and
 * they disagree: on a portal cancellation `cancel_at_period_end` stays FALSE and the end date lands
 * in `cancel_at`.
 *
 * Provenance and redactions: tests/fixtures/stripe/README.md.
 */

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/stripe/live-cancellation-2026-09-06.json'
);

/** The real ids from the production row this reproduces. */
const ACCOUNT_ID = 'acc_c_Ss2xlZck4-2U557UbfE';
const CUSTOMER_ID = 'cus_VCqXR4a2puvwu4';
const SUBSCRIPTION_ID = 'sub_1UCYLgDUb8k2DuQ8mgxO02DC';
const LIVE_PRICE_MONTHLY = 'price_1UAVrsDUb8k2DuQ8Te32EKzr';

/** 2026-10-06T05:10:32Z — what Stripe put in `cancel_at`, and the date the dashboard must show. */
const CANCELS_AT_MS = 1_791_263_432_000;
/** 2026-09-06T05:11:46Z — when the customer clicked cancel. */
const CANCELLED_AT_MS = 1_788_671_506_000;

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

function loadEvents(): Stripe.Event[] {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as Stripe.Event[];
}

describe('a real portal cancellation, replayed from the production event ledger', () => {
  let cwd: string;
  let db: SqliteDatabaseHandle;
  let store: BillingStore;
  let logger: Logger;
  let events: Stripe.Event[];
  let retrieveCalls: string[];

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'aa-stripe-live-'));
    logger = silentLogger();
    db = (await initializeDatabase(
      { sqlitePath: join(cwd, 'app.db'), dataDir: cwd } as never,
      logger
    )) as SqliteDatabaseHandle;
    await runMigrations(db, logger);

    const now = Date.UTC(2026, 8, 6, 5, 0, 0);
    db.sqlite
      .prepare(
        `INSERT INTO accounts (id, email, plan, stripe_customer_id, created_at, updated_at)
         VALUES (?, ?, 'free', ?, ?, ?)`
      )
      .run(ACCOUNT_ID, 'customer@example.test', CUSTOMER_ID, now, now);

    store = new BillingStore(db);
    events = loadEvents();
    retrieveCalls = [];
  });

  afterEach(async () => {
    await db.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  /**
   * `checkout.session.completed` reads the subscription back from the API rather than trusting the
   * session. The stub answers with the subscription object out of `customer.subscription.created` —
   * which IS what Stripe held at that instant, one second earlier in the same fixture — so nothing
   * here is invented and no test touches the network.
   */
  function deps() {
    const created = events.find((event) => event.type === 'customer.subscription.created');
    const subscription = created?.data.object as Stripe.Subscription;
    return {
      store,
      logger,
      prices: { monthly: LIVE_PRICE_MONTHLY, annual: 'price_annual_not_used_here' },
      stripe: {
        subscriptions: {
          retrieve: async (id: string) => {
            retrieveCalls.push(id);
            return subscription;
          },
        },
      } as unknown as Stripe,
    };
  }

  async function replayAll(): Promise<BillingState> {
    for (const event of events) {
      const outcome = await handleStripeEvent(event, deps());
      expect(outcome.status, `${event.id} ${event.type}`).toBe('applied');
    }
    const state = await store.findByAccountId(ACCOUNT_ID);
    if (!state) {
      throw new Error('account vanished');
    }
    return state;
  }

  it('THE DEFECT: after the cancellation the account is not renewing, it is ending', async () => {
    const state = await replayAll();

    // The subscription is still `active` and still Pro — cancelling in the portal does not revoke
    // access, it schedules an end. That part was always right.
    expect(state.plan).toBe('pro');
    expect(state.subscriptionStatus).toBe('active');

    // What was wrong: Stripe never set `cancel_at_period_end`, so nothing recorded that an end had
    // been scheduled and the dashboard rendered its "Renews on" branch.
    expect(state.cancelAt).toBe(CANCELS_AT_MS);
    expect(isCancellationScheduled(state)).toBe(true);
  });

  it('reads the end date from `cancel_at`, not by inferring it from the period end', async () => {
    const state = await replayAll();

    // Here the two agree, because the portal cancels at the end of the period. They are stored and
    // read separately anyway: a `cancel_at` set mid-period — Stripe Dashboard "cancel on a specific
    // date", or the API — makes them differ, and then inferring the date shows the wrong DAY as well
    // as the wrong word.
    expect(accessEndsAt(state)).toBe(CANCELS_AT_MS);
    expect(state.currentPeriodEnd).toBe(CANCELS_AT_MS);
  });

  it('says "set to cancel" on the dashboard, not "Renews on"', async () => {
    const state = await replayAll();

    const view: DashboardBillingView = {
      plan: state.plan,
      comped: false,
      status: state.subscriptionStatus,
      currentPeriodEnd: state.currentPeriodEnd,
      accessEndsAt: accessEndsAt(state),
      cancelScheduled: isCancellationScheduled(state),
      hasCustomer: true,
      paymentAttention: false,
      priceMonthly: '€9',
      priceAnnual: '€90',
    };
    const html = String(
      DashboardSettingsPage({
        account: { id: ACCOUNT_ID, email: 'c@example.test' },
        deployment: 'cloud',
        billing: view,
      })
    );

    expect(html).toContain('set to cancel');
    expect(html).toContain('6 October 2026');
    expect(html).not.toContain('Renews on');
  });

  describe('the other mapped fields, against the same real payloads', () => {
    it('takes the period end off the subscription ITEM, which is the only place it exists now', async () => {
      const subscriptionEvents = events.filter((event) =>
        event.type.startsWith('customer.subscription.')
      );
      expect(subscriptionEvents).toHaveLength(3);
      for (const event of subscriptionEvents) {
        const object = event.data.object as unknown as Record<string, unknown> & {
          items: { data: Array<{ current_period_end: number }> };
        };
        // API 2026-08-26.dahlia does not send a top-level `current_period_end` at all. A mapping
        // that read only the legacy field would store null and render "unknown".
        expect(object.current_period_end).toBeUndefined();
        expect(object.items.data[0]?.current_period_end).toBe(CANCELS_AT_MS / 1000);
      }

      const state = await replayAll();
      expect(state.currentPeriodEnd).toBe(CANCELS_AT_MS);
    });

    it('resolves the plan from the live price id on the item', async () => {
      const state = await replayAll();
      expect(state.plan).toBe('pro');
      expect(state.stripeSubscriptionId).toBe(SUBSCRIPTION_ID);

      // Fail-closed check on the same bytes: an unconfigured price must not grant Pro.
      const other = new BillingStore(db);
      await other.applySubscription({
        accountId: ACCOUNT_ID,
        plan: 'free',
        subscriptionId: null,
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        cancelAt: null,
        eventCreated: 0,
        now: Date.now(),
      });
      for (const event of events) {
        await handleStripeEvent(event, {
          ...deps(),
          prices: { monthly: 'price_someone_elses', annual: 'price_also_not_ours' },
        });
      }
      expect((await store.findByAccountId(ACCOUNT_ID))?.plan).toBe('free');
    });

    it('refreshes the period end from the invoice LINE, not the invoice period_end', async () => {
      const invoice = events.find((event) => event.type === 'invoice.paid');
      const object = invoice?.data.object as unknown as {
        period_start: number;
        period_end: number;
        lines: { data: Array<{ period: { end: number } }> };
      };
      // The trap: on a subscription's first invoice, top-level `period_start` and `period_end` are
      // the SAME instant — the moment the subscription started. Reading `period_end` here would
      // write "your access ends today" onto a customer who just paid for a month.
      expect(object.period_end).toBe(object.period_start);
      expect(object.lines.data[0]?.period.end).toBe(CANCELS_AT_MS / 1000);
    });

    it('holds the cancellation in the ledger with the payload intact', async () => {
      await replayAll();
      const rows = db.sqlite
        .prepare(
          'SELECT id, type, processed_at, payload FROM stripe_events ORDER BY stripe_created'
        )
        .all() as Array<{ id: string; type: string; processed_at: number | null; payload: string }>;

      expect(rows).toHaveLength(5);
      for (const row of rows) {
        expect(row.processed_at, row.id).not.toBeNull();
      }
      const cancellation = rows.find((row) => row.id === 'evt_1UCYMpDUb8k2DuQ8KGAzU0dS');
      const payload = JSON.parse(cancellation?.payload ?? '{}');
      expect(payload.data.object.cancel_at).toBe(CANCELS_AT_MS / 1000);
      expect(payload.data.object.canceled_at).toBe(CANCELLED_AT_MS / 1000);
      // Stripe did not merely leave the old flag false; it never touched it.
      expect(payload.data.previous_attributes).not.toHaveProperty('cancel_at_period_end');
    });

    it('reads the subscription back once, for the checkout session only', async () => {
      await replayAll();
      expect(retrieveCalls).toEqual([SUBSCRIPTION_ID]);
    });
  });
});
