#!/usr/bin/env node
/**
 * Create (or re-confirm) the Stripe Product and Prices that back the Pro plan.
 *
 * RE-RUNNABLE BY DESIGN. It looks the objects up by a stable metadata lookup key before creating
 * anything, so running it twice does not produce a second Product or a duplicate Price. That is what
 * makes going live a re-run against the live key rather than a sequence of Dashboard clicks nobody
 * wrote down.
 *
 * Prices in Stripe are IMMUTABLE — you cannot edit an amount. Changing a price therefore means
 * creating a new one, so this script deactivates any stale price it finds carrying the same lookup
 * key and mints a replacement. Existing subscribers stay on the price they signed up with, which is
 * the behaviour you want: nobody's bill changes because a deploy happened.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup-products.mjs
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup-products.mjs --dry-run
 *
 * It prints the price ids to put in STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_ANNUAL. It never
 * prints the key.
 */
import Stripe from 'stripe';

const PRODUCT_LOOKUP = 'agent_artifacts_pro';
const MONTHLY_LOOKUP = 'agent_artifacts_pro_monthly';
const ANNUAL_LOOKUP = 'agent_artifacts_pro_annual';

// Mirrors src/billing/plans.ts. Kept in sync by hand deliberately: this file must be runnable
// standalone against a bare checkout, without a build step.
const CURRENCY = 'eur';
const MONTHLY_CENTS = 900;
const ANNUAL_CENTS = 9000;

// Must match PRO_TAX_BEHAVIOR in src/billing/plans.ts. 'inclusive' means EUR 9 is the all-in price
// the customer pays and VAT is carved out of it; 'exclusive' adds VAT on top at checkout. Changing
// it retires the existing prices and mints replacements, because Stripe prices are immutable.
const TAX_BEHAVIOR = 'inclusive';

/**
 * Tax category for the Product.
 *
 * "General - Electronically Supplied Services" rather than one of the SaaS codes, because Stripe
 * splits those into PERSONAL USE and BUSINESS USE and this product is sold self-serve to individual
 * developers as well as to small teams. Picking either SaaS variant would assert a buyer type the
 * checkout does not actually know, baked into a tax determination. The general
 * electronically-supplied-services code is the category EU VAT on digital services genuinely turns
 * on, and it covers B2C and B2B alike.
 */
const TAX_CODE = 'txcd_10000000';

const dryRun = process.argv.includes('--dry-run');
const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  console.error('STRIPE_SECRET_KEY is required (never pass it as a CLI argument).');
  process.exit(1);
}

const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST';
const stripe = new Stripe(secretKey, { apiVersion: '2026-08-26.dahlia' });

/**
 * Reuse the Product, or create it under a DETERMINISTIC id.
 *
 * The id is supplied rather than generated, and that is what makes this safely re-runnable.
 * `products.search` was the obvious way to look it up and is the wrong one: Stripe's search index is
 * EVENTUALLY CONSISTENT, so a re-run moments after the first one finds nothing and cheerfully
 * creates a second Product. A direct `retrieve` by a known id is strongly consistent and cannot lie.
 */
async function ensureProduct() {
  try {
    const existing = await stripe.products.retrieve(PRODUCT_LOOKUP);
    if (!existing.deleted) {
      // Reuse is not the same as agreeing. Unlike a Price amount, a Product's tax_code IS mutable,
      // so a re-run reconciles it — otherwise changing the category in this file would never reach
      // Stripe and every invoice would keep being taxed under the old one.
      if (existing.tax_code !== TAX_CODE) {
        console.log(`  product   RETAX   ${existing.tax_code ?? 'none'} -> ${TAX_CODE}`);
        if (!dryRun) {
          await stripe.products.update(existing.id, { tax_code: TAX_CODE });
        }
      }
      console.log(`  product   reuse   ${existing.id}  (${existing.name})`);
      return existing;
    }
  } catch (error) {
    if (error.code !== 'resource_missing') {
      throw error;
    }
  }

  if (dryRun) {
    console.log('  product   CREATE  (dry run)');
    return { id: PRODUCT_LOOKUP };
  }

  const product = await stripe.products.create({
    id: PRODUCT_LOOKUP,
    name: 'Agent Artifacts Pro',
    description:
      'Artifacts live forever, no Agent Artifacts footer on your public pages, and password-protected shares.',
    // Read back only as a sanity signal — entitlement is derived from the PRICE id, which is why the
    // price ids are configuration rather than constants.
    metadata: { lookup_key: PRODUCT_LOOKUP, plan_id: 'pro' },
    tax_code: TAX_CODE,
  });
  console.log(`  product   CREATED ${product.id}`);
  return product;
}

async function ensurePrice(product, { lookupKey, interval, amount }) {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1, active: true });
  const existing = found.data[0];

  if (existing) {
    const matches =
      existing.unit_amount === amount &&
      existing.currency === CURRENCY &&
      existing.recurring?.interval === interval &&
      // Tax behaviour is immutable on a price, so a change here has to mint a new one. Leaving it
      // out of this check would silently keep charging under the old VAT treatment.
      existing.tax_behavior === TAX_BEHAVIOR &&
      // Also check the PRODUCT. A price that carries the right lookup key but hangs off a different
      // (possibly archived) product cannot be checked out, and reusing it would produce a checkout
      // that 400s at the last step.
      existing.product === product.id;
    if (matches) {
      console.log(`  ${interval.padEnd(9)} reuse   ${existing.id}  ${amount / 100} ${CURRENCY}`);
      return existing;
    }
    // Amount or interval drifted. Prices are immutable, so retire this one and mint a new one under
    // the same lookup key. Anyone already subscribed keeps the old price and the old bill.
    console.log(`  ${interval.padEnd(9)} STALE   ${existing.id} -> deactivating`);
    if (!dryRun) {
      await stripe.prices.update(existing.id, { active: false, lookup_key: null });
    }
  }

  if (dryRun) {
    console.log(`  ${interval.padEnd(9)} CREATE  (dry run) ${amount / 100} ${CURRENCY}`);
    return { id: '<dry-run>' };
  }

  const price = await stripe.prices.create({
    product: product.id,
    currency: CURRENCY,
    unit_amount: amount,
    recurring: { interval },
    tax_behavior: TAX_BEHAVIOR,
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    metadata: { plan_id: 'pro' },
  });
  console.log(
    `  ${interval.padEnd(9)} CREATED ${price.id}  ${amount / 100} ${CURRENCY} (${TAX_BEHAVIOR} of VAT)`
  );
  return price;
}

async function main() {
  console.log(
    `\nAgent Artifacts — Stripe product setup  [${mode} MODE]${dryRun ? '  (dry run)' : ''}\n`
  );

  const account = await stripe.accounts.retrieve();
  console.log(
    `  account   ${account.id}  country=${account.country}  currency=${account.default_currency}\n`
  );

  const product = await ensureProduct();
  const monthly = await ensurePrice(product, {
    lookupKey: MONTHLY_LOOKUP,
    interval: 'month',
    amount: MONTHLY_CENTS,
  });
  const annual = await ensurePrice(product, {
    lookupKey: ANNUAL_LOOKUP,
    interval: 'year',
    amount: ANNUAL_CENTS,
  });

  console.log('\n  Put these in the environment:\n');
  console.log(`    STRIPE_PRICE_PRO_MONTHLY=${monthly.id}`);
  console.log(`    STRIPE_PRICE_PRO_ANNUAL=${annual.id}\n`);
}

main().catch((error) => {
  console.error('\nFailed:', error.message);
  process.exit(1);
});
