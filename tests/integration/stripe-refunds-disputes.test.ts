import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BillingState, BillingStore } from '../../src/billing/store.js';
import { handleStripeEvent, RECORD_ONLY_EVENTS } from '../../src/billing/webhook.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Logger } from '../../src/logger.js';

/**
 * Money going OUT, recorded the same way money coming in already is.
 *
 * `invoice.paid` has been in the ledger since billing shipped and nothing about a refund or a
 * chargeback was, which is worse than recording neither: anything that reads `stripe_events` for a
 * revenue figure counts every euro in and misses every euro back out.
 *
 * These are not constructed payloads. They are the bytes Stripe produced for a real €9 refund and a
 * real chargeback in TEST mode on the app's own Stripe account, on the API version
 * `createStripeClient` pins. Provenance and redactions: tests/fixtures/stripe/README.md.
 *
 * The one fact a hand-written fixture would have got wrong, and which drove the account-resolution
 * code: a `dispute` object has NO `customer` field — not a null one, no field at all.
 */

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../fixtures/stripe/test-refund-dispute-2026-09-06.json'
);

const ACCOUNT_ID = 'acc_refund_test';
/** The customer on the refunded charge, and on the charge behind the dispute. */
const CUSTOMER_ID = 'cus_VCz4YUkqHDx30A';
const SUBSCRIPTION_ID = 'sub_refund_test';
/** The charge the dispute points at. Its `customer` is the only route from a dispute to an account. */
const DISPUTED_CHARGE_ID = 'ch_3UCZ6eDcuIe00H3n0rBqRNKv';

interface Fixture {
  events: Stripe.Event[];
  disputedCharge: Stripe.Charge;
}

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
}

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

interface EventRow {
  id: string;
  type: string;
  account_id: string | null;
  stripe_created: number;
  processed_at: number | null;
  payload: string | null;
}

describe('refunds and chargebacks', () => {
  let cwd: string;
  let db: SqliteDatabaseHandle;
  let store: BillingStore;
  let logger: Logger;
  let fixture: Fixture;
  let chargeLookups: string[];
  let chargeLookupFails: boolean;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'aa-stripe-refund-'));
    logger = silentLogger();
    db = (await initializeDatabase(
      { sqlitePath: join(cwd, 'app.db'), dataDir: cwd } as never,
      logger
    )) as SqliteDatabaseHandle;
    await runMigrations(db, logger);

    // A paying account, mid-period. Every assertion below is about this row NOT moving.
    const now = Date.UTC(2026, 8, 6, 5, 0, 0);
    db.sqlite
      .prepare(
        `INSERT INTO accounts (id, email, plan, stripe_customer_id, stripe_subscription_id,
           subscription_status, current_period_end, cancel_at_period_end, billing_updated_at,
           created_at, updated_at)
         VALUES (?, ?, 'pro', ?, ?, 'active', ?, 0, ?, ?, ?)`
      )
      .run(
        ACCOUNT_ID,
        'refunded@example.test',
        CUSTOMER_ID,
        SUBSCRIPTION_ID,
        Date.UTC(2026, 9, 6, 5, 0, 0),
        now,
        now,
        now
      );

    store = new BillingStore(db);
    fixture = loadFixture();
    chargeLookups = [];
    chargeLookupFails = false;
  });

  afterEach(async () => {
    await db.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  /**
   * The Stripe stub answers a charge lookup with the REAL charge captured alongside the events, so
   * the dispute→account hop is exercised against Stripe's own bytes and no test touches the network.
   */
  function deps() {
    return {
      store,
      logger,
      prices: { monthly: 'price_monthly_unused', annual: 'price_annual_unused' },
      stripe: {
        charges: {
          retrieve: async (id: string) => {
            chargeLookups.push(id);
            if (chargeLookupFails) {
              throw new Error('Stripe is unreachable');
            }
            return fixture.disputedCharge;
          },
        },
        subscriptions: {
          retrieve: async () => {
            throw new Error('a refund must never read a subscription back');
          },
        },
      } as unknown as Stripe,
    };
  }

  function eventOfType(type: string): Stripe.Event {
    const event = fixture.events.find((candidate) => candidate.type === type);
    if (!event) {
      throw new Error(`fixture has no ${type}`);
    }
    return event;
  }

  function rowFor(eventId: string): EventRow | undefined {
    return db.sqlite.prepare('SELECT * FROM stripe_events WHERE id = ?').get(eventId) as
      | EventRow
      | undefined;
  }

  async function stateNow(): Promise<BillingState> {
    const state = await store.findByAccountId(ACCOUNT_ID);
    if (!state) {
      throw new Error('account vanished');
    }
    return state;
  }

  it('records a refund instead of dropping it at the HANDLED_EVENTS gate', async () => {
    const event = eventOfType('charge.refunded');

    const outcome = await handleStripeEvent(event, deps());

    // `handleStripeEvent` returns `ignored` BEFORE `recordEvent`, so a type missing from
    // HANDLED_EVENTS is acknowledged 200 and silently dropped. This is the half that catches that.
    expect(outcome.status).toBe('applied');
    const row = rowFor(event.id);
    expect(row?.type).toBe('charge.refunded');
    expect(row?.account_id).toBe(ACCOUNT_ID);
    expect(row?.processed_at).not.toBeNull();
    // The stored payload is the money-out fact itself, not a summary of it.
    const payload = JSON.parse(row?.payload ?? '{}');
    expect(payload.data.object.amount_refunded).toBe(900);
    expect(payload.data.object.currency).toBe('eur');
  });

  it('does not touch plan, status or entitlement when a charge is refunded', async () => {
    const before = await stateNow();

    const outcome = await handleStripeEvent(eventOfType('charge.refunded'), deps());

    expect(outcome.status).toBe('applied');
    // A refund is a financial fact, not a subscription one. Stripe does not cancel a subscription
    // when you refund it, and neither does this.
    expect(await stateNow()).toEqual(before);
  });

  it('records a refund status change, which is the only thing that can say a refund FAILED', async () => {
    const event = eventOfType('charge.refund.updated');
    const before = await stateNow();

    const outcome = await handleStripeEvent(event, deps());

    expect(outcome.status).toBe('applied');
    expect(rowFor(event.id)?.account_id).toBe(ACCOUNT_ID);
    expect(await stateNow()).toEqual(before);
  });

  it('links a dispute to its account through the charge, because a dispute carries no customer', async () => {
    const event = eventOfType('charge.dispute.created');
    // The fact that made the hop necessary, asserted against Stripe's own bytes.
    expect(event.data.object).not.toHaveProperty('customer');

    const outcome = await handleStripeEvent(event, deps());

    expect(outcome.status).toBe('applied');
    expect(chargeLookups).toEqual([DISPUTED_CHARGE_ID]);
    expect(rowFor(event.id)?.account_id).toBe(ACCOUNT_ID);
  });

  it('still records a dispute when the account cannot be resolved', async () => {
    chargeLookupFails = true;
    const event = eventOfType('charge.dispute.created');

    const outcome = await handleStripeEvent(event, deps());

    // An unlinked chargeback row is far better than a dropped one, and a throw here would drop it:
    // account resolution runs BEFORE the row is written.
    expect(outcome.status).toBe('unresolved');
    const row = rowFor(event.id);
    expect(row?.type).toBe('charge.dispute.created');
    expect(row?.account_id).toBeNull();
    expect(row?.processed_at).not.toBeNull();
  });

  it('does not suspend or downgrade an account that has been charged back', async () => {
    const before = await stateNow();

    const outcome = await handleStripeEvent(eventOfType('charge.dispute.created'), deps());

    expect(outcome.status).toBe('applied');
    // A chargeback is a signal a human should look at, not a trigger to cut off access.
    expect(await stateNow()).toEqual(before);
  });

  it('records how a dispute ended, which is what makes the money-out figure final', async () => {
    const event = eventOfType('charge.dispute.closed');

    const outcome = await handleStripeEvent(event, deps());

    expect(outcome.status).toBe('applied');
    const payload = JSON.parse(rowFor(event.id)?.payload ?? '{}');
    // `created` alone cannot distinguish a dispute we won (money came back) from one we lost.
    expect(payload.data.object.status).toBe('lost');
    expect(payload.data.previous_attributes.status).toBe('needs_response');
  });

  it('does not drop a refund that is older than the last subscription write', async () => {
    // The out-of-order guard exists to stop a late subscription event resurrecting entitlement.
    // A refund writes nothing, so there is nothing to invert — and dropping it would lose the money.
    const event = eventOfType('charge.refunded');
    const future = event.created * 1000 + 60_000;
    db.sqlite
      .prepare('UPDATE accounts SET billing_updated_at = ? WHERE id = ?')
      .run(future, ACCOUNT_ID);

    const outcome = await handleStripeEvent(event, deps());

    expect(outcome.status).toBe('applied');
    expect(rowFor(event.id)).toBeDefined();
  });

  it('records a redelivered refund exactly once', async () => {
    const event = eventOfType('charge.refunded');

    const first = await handleStripeEvent(event, deps());
    const second = await handleStripeEvent(event, deps());

    expect(first.status).toBe('applied');
    expect(second.status).toBe('duplicate');
    const count = db.sqlite
      .prepare('SELECT COUNT(*) AS c FROM stripe_events WHERE id = ?')
      .get(event.id) as { c: number };
    expect(count.c).toBe(1);
  });

  it('records every type it claims to record, and changes state for none of them', async () => {
    const before = await stateNow();

    for (const event of fixture.events) {
      expect(RECORD_ONLY_EVENTS.has(event.type), `${event.type} is not declared record-only`).toBe(
        true
      );
      const outcome = await handleStripeEvent(event, deps());
      expect(outcome.status, `${event.id} ${event.type}`).toBe('applied');
      expect(rowFor(event.id), `${event.id} was not written`).toBeDefined();
    }

    expect(await stateNow()).toEqual(before);
  });
});
