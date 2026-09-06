/**
 * Re-derive one account's billing row from Stripe, through the SAME mapping a webhook uses.
 *
 * WHY THIS EXISTS RATHER THAN AN UPDATE STATEMENT. When a mapping bug is found, the rows it wrote
 * are wrong and have to be repaired. A hand-written UPDATE repairs them by restating the fix in a
 * second dialect — SQL — which then agrees with the code only until one of the two is edited, and
 * nobody finds out which. This calls `subscriptionSnapshot`, the exported mapper the webhook path
 * calls, against the live subscription. If the mapping is right the repair is right, and if the
 * mapping is wrong the repair reproduces the bug loudly instead of papering over it.
 *
 * It is a repair tool, not a sync job. A webhook remains the only routine writer of these columns.
 *
 *   # dry run — reads Stripe and the database, writes nothing
 *   node --env-file=.env node_modules/.bin/tsx scripts/billing-resync.ts --account acc_xxx
 *
 *   # apply
 *   node --env-file=.env node_modules/.bin/tsx scripts/billing-resync.ts --account acc_xxx --apply
 *
 * Prints the row before and after with a per-column diff. Nothing it prints is a credential.
 */
import pino from 'pino';
import { createStripeClient } from '../src/billing/routes.js';
import { accessEndsAt, type BillingState, BillingStore } from '../src/billing/store.js';
import { subscriptionSnapshot } from '../src/billing/webhook.js';
import { loadConfig } from '../src/config.js';
import { initializeDatabase } from '../src/db/client.js';
import type { Logger } from '../src/logger.js';

interface Args {
  accountId: string;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  let accountId: string | undefined;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--apply') {
      apply = true;
    } else if (flag === '--account') {
      i += 1;
      accountId = argv[i];
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!accountId) {
    throw new Error('--account <id> is required (SELECT id FROM accounts WHERE email = ...)');
  }
  return { accountId, apply };
}

const MS = (value: number | null) =>
  value === null ? 'null' : `${value}  (${new Date(value).toISOString()})`;

function describe(state: BillingState): Record<string, string> {
  return {
    plan: state.plan,
    comp_plan: String(state.compPlan),
    stripe_subscription_id: String(state.stripeSubscriptionId),
    subscription_status: String(state.subscriptionStatus),
    current_period_end: MS(state.currentPeriodEnd),
    cancel_at_period_end: String(state.cancelAtPeriodEnd),
    cancel_at: MS(state.cancelAt),
    billing_updated_at: MS(state.billingUpdatedAt),
    '(derived) access ends': MS(accessEndsAt(state)),
  };
}

function print(title: string, row: Record<string, string>): void {
  console.log(`\n${title}`);
  for (const [key, value] of Object.entries(row)) {
    console.log(`  ${key.padEnd(24)} ${value}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  if (!config.billing) {
    throw new Error(
      'billing is not configured in this environment (AA_BILLING_ENABLED / STRIPE_*)'
    );
  }

  const logger = pino({ level: 'warn' }) as unknown as Logger;
  const db = await initializeDatabase(config, logger);
  try {
    const store = new BillingStore(db);
    const before = await store.findByAccountId(args.accountId);
    if (!before) {
      throw new Error(`no account with id ${args.accountId}`);
    }

    console.log(`account   ${before.accountId}`);
    console.log(`customer  ${before.stripeCustomerId}`);
    print('BEFORE (stored)', describe(before));

    if (!before.stripeSubscriptionId) {
      console.log('\nNo subscription id on this account — nothing to re-derive. Not written.');
      return;
    }

    const stripe = createStripeClient(config.billing);
    const subscription = await stripe.subscriptions.retrieve(before.stripeSubscriptionId);
    const snapshot = subscriptionSnapshot(subscription, {
      monthly: config.billing.priceProMonthly,
      annual: config.billing.priceProAnnual,
    });

    // `billing_updated_at` is the out-of-order guard's watermark and belongs to the last event
    // Stripe delivered. A repair is not an event and must not move it: raising it would make the
    // app drop the next real webhook as stale; lowering it would re-admit an old one.
    const after: BillingState = { ...before, ...snapshot };
    print('AFTER (re-derived from Stripe)', describe(after));

    const changes = Object.entries(describe(after)).filter(
      ([key, value]) => describe(before)[key] !== value
    );
    if (changes.length === 0) {
      console.log('\nNo change. The stored row already matches Stripe. Nothing written.');
      return;
    }
    console.log('\nCHANGES');
    for (const [key, value] of changes) {
      console.log(`  ${key.padEnd(24)} ${describe(before)[key]}  ->  ${value}`);
    }

    if (!args.apply) {
      console.log('\nDRY RUN — nothing written. Re-run with --apply to write these changes.');
      return;
    }

    await store.applySubscription({
      accountId: before.accountId,
      ...snapshot,
      eventCreated: before.billingUpdatedAt ?? Date.now(),
      now: Date.now(),
    });
    const written = await store.findByAccountId(before.accountId);
    print('WRITTEN (re-read from the database)', describe(written as BillingState));
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
