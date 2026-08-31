import type { Plan } from '../extension/cloud-module.js';

/** The two entitlement levels the product sells. Stored in `accounts.plan`. */
export type PlanId = 'free' | 'pro';

/** Which recurring price a customer is buying. Maps to one Stripe Price each. */
export type BillingInterval = 'monthly' | 'annual';

export function isPlanId(value: unknown): value is PlanId {
  return value === 'free' || value === 'pro';
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'monthly' || value === 'annual';
}

/**
 * The published pricing card, as code.
 *
 * Free and Pro differ in exactly three things — the footer, retention, and password-protected
 * shares. Neither tier has a count limit: `maxBots` and `maxArtifacts` are `null` on both, because
 * the product sells permanence and removal of branding, not quantity.
 *
 * "Your own subdomain" is on the Pro card as *(coming soon)* and is deliberately absent here: it is
 * not built, so it grants nothing and gates nothing.
 */
export interface PlanShape {
  id: PlanId;
  name: string;
  showFooter: boolean;
  /** `null` = keep forever. A number is a window in days, enforced by the background sweep. */
  retentionDays: number | null;
  /** Password-protected shares are the one metered feature behind Pro. */
  allowSharePassword: boolean;
}

export const FREE_PLAN: PlanShape = {
  id: 'free',
  name: 'Free',
  showFooter: true,
  retentionDays: null, // overridden per-account by BillingModule; see resolveRetentionDays
  allowSharePassword: false,
};

export const PRO_PLAN: PlanShape = {
  id: 'pro',
  name: 'Pro',
  showFooter: false,
  retentionDays: null,
  allowSharePassword: true,
};

export function planShape(id: PlanId): PlanShape {
  return id === 'pro' ? PRO_PLAN : FREE_PLAN;
}

/**
 * The published amounts, in the smallest currency unit.
 *
 * One definition, used by three things that must never disagree: the marketing pricing card, the
 * dashboard upgrade buttons, and `scripts/stripe-setup-products.mjs`, which creates the actual
 * Stripe Prices. If these lived in three places, the day someone changed the price would be the day
 * the site advertised one number and charged another.
 *
 * EUR because the Stripe account's default currency is EUR and the merchant is in Croatia.
 */
export const PRO_CURRENCY = 'eur';
export const PRO_PRICE_MONTHLY_CENTS = 900;
/** Twelve months for the price of ten. */
export const PRO_PRICE_ANNUAL_CENTS = 9000;

export function formatPrice(cents: number, currency: string = PRO_CURRENCY): string {
  const symbol = currency === 'eur' ? '€' : currency === 'usd' ? '$' : `${currency.toUpperCase()} `;
  const whole = cents / 100;
  // Whole amounts read better without trailing zeros on a pricing button: "€9", not "€9.00".
  return `${symbol}${Number.isInteger(whole) ? whole : whole.toFixed(2)}`;
}

/** Project a plan shape into the `CloudModule` contract the rest of the app already consumes. */
export function toCloudPlan(shape: PlanShape, retentionDays: number | null): Plan {
  return {
    id: shape.id,
    name: shape.name,
    showFooter: shape.showFooter,
    // Neither tier limits counts. Kept explicit so a future limit is a deliberate edit here rather
    // than an accident somewhere in the quota path.
    limits: { maxBots: null, maxArtifacts: null },
    artifact_retention_days: retentionDays,
  };
}

/**
 * Map a Stripe Price id back to a plan.
 *
 * Deliberately driven by CONFIGURED price ids rather than a hardcoded table: price ids differ
 * between test and live mode, so a constant would be wrong in exactly one of the two environments —
 * and it would be wrong silently, granting free access to a paying customer.
 *
 * Anything unrecognised maps to `free`. That is the fail-closed direction: an unknown price should
 * never hand out Pro.
 */
export function planForPriceId(
  priceId: string | null | undefined,
  prices: { monthly: string; annual: string }
): PlanId {
  if (!priceId) {
    return 'free';
  }
  return priceId === prices.monthly || priceId === prices.annual ? 'pro' : 'free';
}

/**
 * Stripe subscription statuses that entitle the customer to Pro.
 *
 * `past_due` is INCLUDED on purpose. Stripe's Smart Retries are still working the payment at that
 * point, and most past-due subscriptions recover on their own within days. Revoking a paying
 * customer's features on the first failed retry — usually an expired card — turns a silent
 * self-healing event into a support ticket and a cancellation. They keep access and see a banner;
 * if retries are exhausted Stripe moves them to `unpaid` or `canceled` and they downgrade then.
 */
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

export function planForSubscriptionStatus(
  status: string | null | undefined,
  pricePlan: PlanId
): PlanId {
  if (!status || !ENTITLED_STATUSES.has(status)) {
    return 'free';
  }
  return pricePlan;
}

/** Statuses worth surfacing to the customer as "your payment needs attention". */
export function isPaymentAttentionStatus(status: string | null | undefined): boolean {
  return status === 'past_due' || status === 'unpaid' || status === 'incomplete';
}
