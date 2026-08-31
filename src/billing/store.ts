import type { DatabaseHandle } from '../db/client.js';
import { isPlanId, type PlanId } from './plans.js';

/**
 * An account's billing state, as stored. Everything here is a cache of Stripe except `compPlan` and
 * `grandfatheredAt`, which are ours and which no webhook may overwrite.
 */
export interface BillingState {
  accountId: string;
  email: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  plan: PlanId;
  compPlan: PlanId | null;
  grandfatheredAt: number | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  billingUpdatedAt: number | null;
}

interface BillingRow {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: string | null;
  comp_plan: string | null;
  grandfathered_at: number | string | null;
  subscription_status: string | null;
  current_period_end: number | string | null;
  cancel_at_period_end: number | boolean | null;
  billing_updated_at: number | string | null;
}

const SELECT_COLUMNS = `id, email, stripe_customer_id, stripe_subscription_id, plan, comp_plan,
  grandfathered_at, subscription_status, current_period_end, cancel_at_period_end, billing_updated_at`;

function num(value: number | string | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toState(row: BillingRow): BillingState {
  return {
    accountId: row.id,
    email: row.email,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    plan: isPlanId(row.plan) ? row.plan : 'free',
    compPlan: isPlanId(row.comp_plan) ? row.comp_plan : null,
    grandfatheredAt: num(row.grandfathered_at),
    subscriptionStatus: row.subscription_status,
    currentPeriodEnd: num(row.current_period_end),
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    billingUpdatedAt: num(row.billing_updated_at),
  };
}

export class BillingStore {
  constructor(private readonly db: DatabaseHandle) {}

  async findByAccountId(accountId: string): Promise<BillingState | null> {
    const row = await this.selectOne(`WHERE id = ${this.p(1)}`, [accountId]);
    return row ? toState(row) : null;
  }

  /** Primary webhook resolution path: Stripe tells us the customer, we find the account. */
  async findByCustomerId(customerId: string): Promise<BillingState | null> {
    const row = await this.selectOne(`WHERE stripe_customer_id = ${this.p(1)}`, [customerId]);
    return row ? toState(row) : null;
  }

  private p(index: number): string {
    return this.db.dialect === 'sqlite' ? '?' : `$${index}`;
  }

  private async selectOne(where: string, params: unknown[]): Promise<BillingRow | null> {
    const sql = `SELECT ${SELECT_COLUMNS} FROM accounts ${where} LIMIT 1`;
    if (this.db.dialect === 'sqlite') {
      return (this.db.sqlite.prepare(sql).get(...params) as BillingRow | undefined) ?? null;
    }
    const result = await this.db.pool.query<BillingRow>(sql, params);
    return result.rows[0] ?? null;
  }

  /**
   * Attach a Stripe customer to an account.
   *
   * Written BEFORE the Checkout Session is created, so an abandoned checkout still leaves the
   * customer reusable — otherwise a user who tries three times accumulates three Stripe Customers
   * and their billing history splits across all of them.
   */
  async setCustomerId(accountId: string, customerId: string, now: number): Promise<void> {
    await this.run(
      `UPDATE accounts SET stripe_customer_id = ${this.p(1)}, updated_at = ${this.p(2)}
       WHERE id = ${this.p(3)} AND stripe_customer_id IS NULL`,
      [customerId, now, accountId]
    );
  }

  /**
   * Apply a subscription snapshot derived from a webhook.
   *
   * `comp_plan` and `grandfathered_at` are NOT in the SET list, and that is the whole safety
   * property: an operator grant and a grandfather stamp survive every event Stripe can send,
   * including `customer.subscription.deleted`.
   */
  async applySubscription(input: {
    accountId: string;
    plan: PlanId;
    subscriptionId: string | null;
    status: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
    eventCreated: number;
    now: number;
  }): Promise<void> {
    const cancelValue =
      this.db.dialect === 'sqlite' ? (input.cancelAtPeriodEnd ? 1 : 0) : input.cancelAtPeriodEnd;
    await this.run(
      `UPDATE accounts SET
         plan = ${this.p(1)},
         stripe_subscription_id = ${this.p(2)},
         subscription_status = ${this.p(3)},
         current_period_end = ${this.p(4)},
         cancel_at_period_end = ${this.p(5)},
         billing_updated_at = ${this.p(6)},
         updated_at = ${this.p(7)}
       WHERE id = ${this.p(8)}`,
      [
        input.plan,
        input.subscriptionId,
        input.status,
        input.currentPeriodEnd,
        cancelValue,
        input.eventCreated,
        input.now,
        input.accountId,
      ]
    );
  }

  /** Defensive path for `customer.deleted`: forget the customer so a later upgrade mints a fresh one. */
  async clearCustomer(accountId: string, now: number): Promise<void> {
    await this.run(
      `UPDATE accounts SET stripe_customer_id = NULL, stripe_subscription_id = NULL,
         plan = 'free', subscription_status = NULL, current_period_end = NULL,
         cancel_at_period_end = ${this.db.dialect === 'sqlite' ? '0' : 'FALSE'},
         updated_at = ${this.p(1)}
       WHERE id = ${this.p(2)}`,
      [now, accountId]
    );
  }

  /** Operator grant. The only writer of `comp_plan`; never reached from a webhook. */
  async setCompPlan(accountId: string, plan: PlanId | null, now: number): Promise<number> {
    return this.run(
      `UPDATE accounts SET comp_plan = ${this.p(1)}, updated_at = ${this.p(2)} WHERE id = ${this.p(3)}`,
      [plan, now, accountId]
    );
  }

  async setCompPlanByEmail(email: string, plan: PlanId | null, now: number): Promise<number> {
    return this.run(
      `UPDATE accounts SET comp_plan = ${this.p(1)}, updated_at = ${this.p(2)} WHERE email = ${this.p(3)}`,
      [plan, now, email]
    );
  }

  /**
   * Record the event and report whether it is new.
   *
   * The insert is the idempotency check: the table's primary key is Stripe's own `evt_...`, so a
   * duplicate delivery collides instead of being applied twice. Returns false when already seen.
   */
  async recordEvent(input: {
    id: string;
    type: string;
    accountId: string | null;
    stripeCreated: number;
    payload: string | null;
    now: number;
  }): Promise<boolean> {
    const sql =
      this.db.dialect === 'sqlite'
        ? `INSERT OR IGNORE INTO stripe_events (id, type, account_id, stripe_created, payload, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        : `INSERT INTO stripe_events (id, type, account_id, stripe_created, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`;
    const changed = await this.run(sql, [
      input.id,
      input.type,
      input.accountId,
      input.stripeCreated,
      input.payload,
      input.now,
    ]);
    return changed > 0;
  }

  async markEventProcessed(eventId: string, now: number): Promise<void> {
    await this.run(`UPDATE stripe_events SET processed_at = ${this.p(1)} WHERE id = ${this.p(2)}`, [
      now,
      eventId,
    ]);
  }

  async hasProcessedEvent(eventId: string): Promise<boolean> {
    const sql = `SELECT processed_at FROM stripe_events WHERE id = ${this.p(1)} LIMIT 1`;
    if (this.db.dialect === 'sqlite') {
      const row = this.db.sqlite.prepare(sql).get(eventId) as
        | { processed_at: number | null }
        | undefined;
      return Boolean(row && row.processed_at !== null);
    }
    const result = await this.db.pool.query<{ processed_at: number | string | null }>(sql, [
      eventId,
    ]);
    const row = result.rows[0];
    return Boolean(row && row.processed_at !== null);
  }

  /** Billing PII does not need to live forever; the background sweep calls this. */
  async purgeEventPayloads(cutoff: number): Promise<number> {
    return this.run(
      `UPDATE stripe_events SET payload = NULL WHERE payload IS NOT NULL AND created_at <= ${this.p(1)}`,
      [cutoff]
    );
  }

  private async run(sql: string, params: unknown[]): Promise<number> {
    if (this.db.dialect === 'sqlite') {
      return Number(this.db.sqlite.prepare(sql).run(...(params as never[])).changes);
    }
    const result = await this.db.pool.query(sql, params);
    return result.rowCount ?? 0;
  }
}
