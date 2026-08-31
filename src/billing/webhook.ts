import type Stripe from 'stripe';
import type { Logger } from '../logger.js';
import { type PlanId, planForPriceId, planForSubscriptionStatus } from './plans.js';
import type { BillingState, BillingStore } from './store.js';

/**
 * Events that move entitlement. Anything not in here is acknowledged with 200 and ignored — a
 * handler that 500s on an unrecognised type turns "someone enabled a new event in the Dashboard"
 * into a three-day retry storm.
 */
export const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.deleted',
]);

export interface WebhookDeps {
  store: BillingStore;
  stripe: Stripe;
  prices: { monthly: string; annual: string };
  logger: Logger;
  now?: () => number;
}

export type WebhookOutcome =
  | { status: 'applied'; eventId: string; accountId: string | null }
  | { status: 'duplicate'; eventId: string }
  | { status: 'stale'; eventId: string }
  | { status: 'ignored'; eventId: string }
  | { status: 'unresolved'; eventId: string };

/**
 * Apply one verified Stripe event.
 *
 * Ordering inside this function matters. The event is recorded FIRST, so a duplicate delivery is
 * rejected before it can do anything, and only then is state applied. Recording after applying
 * would leave a window where a retry double-applies.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  deps: WebhookDeps
): Promise<WebhookOutcome> {
  const now = deps.now?.() ?? Date.now();
  // Stripe timestamps are seconds; everything in this codebase is milliseconds.
  const eventCreated = event.created * 1000;

  if (!HANDLED_EVENTS.has(event.type)) {
    return { status: 'ignored', eventId: event.id };
  }

  const state = await resolveAccount(event, deps);

  const isNew = await deps.store.recordEvent({
    id: event.id,
    type: event.type,
    accountId: state?.accountId ?? null,
    stripeCreated: eventCreated,
    payload: JSON.stringify(event).slice(0, 20_000),
    now,
  });

  if (!isNew) {
    // Already in the ledger. If a previous attempt crashed before marking it processed we let it
    // through once more; otherwise this is a plain retry of work already done.
    const processed = await deps.store.hasProcessedEvent(event.id);
    if (processed) {
      deps.logger.info({ event_id: event.id, type: event.type }, 'billing.webhook.duplicate');
      return { status: 'duplicate', eventId: event.id };
    }
  }

  if (!state) {
    // Nothing to update — commonly a customer created outside the app, or an event for a deleted
    // account. Recorded, acknowledged, and not retried.
    deps.logger.warn(
      { event_id: event.id, type: event.type },
      'billing.webhook.account_unresolved'
    );
    await deps.store.markEventProcessed(event.id, now);
    return { status: 'unresolved', eventId: event.id };
  }

  /**
   * OUT-OF-ORDER GUARD. Stripe does not promise delivery order, and retries make inversions
   * routine: a delayed `subscription.updated` arriving after `subscription.deleted` would otherwise
   * resurrect a cancelled subscription and hand back Pro to someone who no longer pays.
   *
   * `invoice.*` events are exempt because they are not the writer of subscription status — they
   * refresh the period end and the payment-attention flag only, and their ordering relative to
   * subscription events carries no entitlement meaning.
   */
  const isSubscriptionEvent =
    event.type.startsWith('customer.subscription.') || event.type === 'checkout.session.completed';
  if (
    isSubscriptionEvent &&
    state.billingUpdatedAt !== null &&
    eventCreated < state.billingUpdatedAt
  ) {
    deps.logger.warn(
      {
        event_id: event.id,
        type: event.type,
        event_created: eventCreated,
        last_applied: state.billingUpdatedAt,
      },
      'billing.webhook.stale_event_dropped'
    );
    await deps.store.markEventProcessed(event.id, now);
    return { status: 'stale', eventId: event.id };
  }

  await applyEvent(event, state, deps, { now, eventCreated });
  await deps.store.markEventProcessed(event.id, now);

  deps.logger.info(
    { event_id: event.id, type: event.type, account_id: state.accountId },
    'billing.webhook.applied'
  );
  return { status: 'applied', eventId: event.id, accountId: state.accountId };
}

/**
 * Find the account this event belongs to.
 *
 * Customer id first because it is the durable link and is present on every event we handle. The
 * `client_reference_id` / metadata fallbacks matter for the very first event of a subscription's
 * life, where a race between the redirect and the webhook can mean the customer id has not been
 * persisted yet.
 */
async function resolveAccount(
  event: Stripe.Event,
  deps: WebhookDeps
): Promise<BillingState | null> {
  const object = event.data.object as unknown as Record<string, unknown>;

  const customerId = extractCustomerId(object);
  if (customerId) {
    const byCustomer = await deps.store.findByCustomerId(customerId);
    if (byCustomer) {
      return byCustomer;
    }
  }

  const clientReferenceId =
    typeof object.client_reference_id === 'string' ? object.client_reference_id : null;
  if (clientReferenceId) {
    const byReference = await deps.store.findByAccountId(clientReferenceId);
    if (byReference) {
      return byReference;
    }
  }

  const metadata = object.metadata as Record<string, unknown> | null | undefined;
  const metaAccountId =
    metadata && typeof metadata.account_id === 'string' ? metadata.account_id : null;
  if (metaAccountId) {
    return deps.store.findByAccountId(metaAccountId);
  }

  return null;
}

function extractCustomerId(object: Record<string, unknown>): string | null {
  const customer = object.customer;
  if (typeof customer === 'string') {
    return customer;
  }
  if (customer && typeof customer === 'object' && 'id' in customer) {
    const id = (customer as { id: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

async function applyEvent(
  event: Stripe.Event,
  state: BillingState,
  deps: WebhookDeps,
  clock: { now: number; eventCreated: number }
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // Guard both: a one-off payment session and an unpaid session must never grant Pro.
      if (session.mode !== 'subscription' || session.payment_status === 'unpaid') {
        return;
      }
      // Persist the customer link if the redirect race meant we did not have it yet.
      const customerId = extractCustomerId(session as unknown as Record<string, unknown>);
      if (customerId && !state.stripeCustomerId) {
        await deps.store.setCustomerId(state.accountId, customerId, clock.now);
      }
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : ((session.subscription as Stripe.Subscription | null)?.id ?? null);
      if (!subscriptionId) {
        return;
      }
      // Read the subscription back rather than trusting the session: the session carries no status
      // or period end, and those are what entitlement is actually derived from.
      const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
      await applySubscriptionObject(subscription, state, deps, clock);
      return;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await applySubscriptionObject(subscription, state, deps, clock);
      return;
    }

    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const periodEnd = invoicePeriodEnd(invoice);
      // Money settled. Refresh the period end and clear any payment-attention status, but do not
      // invent an entitlement: the subscription events remain the authority on plan.
      await deps.store.applySubscription({
        accountId: state.accountId,
        plan: state.plan,
        subscriptionId: state.stripeSubscriptionId,
        status: state.subscriptionStatus === 'past_due' ? 'active' : state.subscriptionStatus,
        currentPeriodEnd: periodEnd ?? state.currentPeriodEnd,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        eventCreated: state.billingUpdatedAt ?? clock.eventCreated,
        now: clock.now,
      });
      return;
    }

    case 'invoice.payment_failed': {
      // Flag it, do NOT downgrade: Stripe's Smart Retries are still working the payment, and most
      // of these recover without the customer doing anything.
      await deps.store.applySubscription({
        accountId: state.accountId,
        plan: state.plan,
        subscriptionId: state.stripeSubscriptionId,
        status: 'past_due',
        currentPeriodEnd: state.currentPeriodEnd,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        eventCreated: state.billingUpdatedAt ?? clock.eventCreated,
        now: clock.now,
      });
      return;
    }

    case 'customer.deleted': {
      await deps.store.clearCustomer(state.accountId, clock.now);
      return;
    }

    default:
      return;
  }
}

async function applySubscriptionObject(
  subscription: Stripe.Subscription,
  state: BillingState,
  deps: WebhookDeps,
  clock: { now: number; eventCreated: number }
): Promise<void> {
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null;
  const pricePlan = planForPriceId(priceId, deps.prices);
  const plan: PlanId = planForSubscriptionStatus(subscription.status, pricePlan);
  const periodEnd = subscriptionPeriodEnd(subscription);
  const ended = subscription.status === 'canceled' || subscription.status === 'incomplete_expired';

  await deps.store.applySubscription({
    accountId: state.accountId,
    plan,
    // Forget the subscription id once it has genuinely ended, so a later upgrade starts clean.
    subscriptionId: ended ? null : subscription.id,
    status: subscription.status,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    eventCreated: clock.eventCreated,
    now: clock.now,
  });
}

/**
 * Period end, in ms.
 *
 * Stripe moved `current_period_end` from the subscription onto its items in recent API versions, so
 * both shapes are read: the item's value when present, the legacy top-level field otherwise. Reading
 * only one of them silently yields a null renewal date against the other API version.
 */
function subscriptionPeriodEnd(subscription: Stripe.Subscription): number | null {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
  if (typeof item?.current_period_end === 'number') {
    return item.current_period_end * 1000;
  }
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  return typeof legacy === 'number' ? legacy * 1000 : null;
}

function invoicePeriodEnd(invoice: Stripe.Invoice): number | null {
  const line = invoice.lines?.data?.[0] as { period?: { end?: number } } | undefined;
  return typeof line?.period?.end === 'number' ? line.period.end * 1000 : null;
}
