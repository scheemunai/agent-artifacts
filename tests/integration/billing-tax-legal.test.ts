import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { Hono } from 'hono';
import pino from 'pino';
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PRO_TAX_BEHAVIOR } from '../../src/billing/plans.js';
import { registerBillingDashboardRoutes } from '../../src/billing/routes.js';
import { BillingStore } from '../../src/billing/store.js';
import type { AppConfig, BillingConfig } from '../../src/config.js';
import { initializeDatabase, type SqliteDatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrations.js';
import type { Logger } from '../../src/logger.js';
import {
  LEGAL_DOCUMENTS,
  type LegalDocument,
  LegalPage,
  legalDocument,
} from '../../src/ui/pages/legal.js';

const ACCOUNT_ID = 'acc_tax_test';
const CUSTOMER_ID = 'cus_tax_test';

function silentLogger(sink: string[] = []): Logger {
  return pino(
    { level: 'error' },
    new Writable({
      write(chunk, _e, cb) {
        sink.push(String(chunk));
        cb();
      },
    })
  ) as unknown as Logger;
}

const billingConfig: BillingConfig = {
  secretKey: 'sk_test_dummy',
  webhookSecret: 'whsec_dummy',
  priceProMonthly: 'price_monthly',
  priceProAnnual: 'price_annual',
  freeRetentionDays: 7,
  retentionEnforcementEnabled: false,
};

describe('legal pages', () => {
  it('ships Terms, Refund and Privacy documents', () => {
    expect(Object.keys(LEGAL_DOCUMENTS).sort()).toEqual(['privacy', 'refund-policy', 'terms']);
  });

  it('resolves a known slug and refuses an unknown one', () => {
    expect(legalDocument('terms')?.title).toBe('Terms of Service');
    expect(legalDocument('not-a-document')).toBeUndefined();
  });

  it('renders each document with its own footer links back to the other two', () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      const html = String(LegalPage({ document }));
      // The renderer escapes, so compare against the escaped title ("Refund &amp; Cancellation").
      expect(html).toContain(document.title.replaceAll('&', '&amp;'));
      expect(html).toContain('href="/terms"');
      expect(html).toContain('href="/refund-policy"');
      expect(html).toContain('href="/privacy"');
    }
  });

  /**
   * The placeholder text has to SAY it is a placeholder. A page that reads like a finished contract
   * but was written by neither a lawyer nor the company is a document a customer could rely on.
   */
  it('states plainly that the current text is a draft', () => {
    const terms = String(LegalPage({ document: legalDocument('terms') as LegalDocument }));
    expect(terms).toContain('placeholder pending final legal text');
    expect(terms).toContain('[Company legal name]');
  });

  it('describes cancellation the way the code actually behaves', () => {
    const refunds = String(
      LegalPage({ document: legalDocument('refund-policy') as LegalDocument })
    );
    // cancel_at_period_end, and past_due retaining access, are real behaviours — the policy must
    // not contradict them.
    expect(refunds).toContain('end of the period you have already paid for');
    expect(refunds).toContain('Pro features stay active during that window');
  });
});

describe('checkout session tax parameters', () => {
  let cwd: string;
  let db: SqliteDatabaseHandle;
  let store: BillingStore;
  let logger: Logger;
  let logSink: string[];

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'aa-tax-'));
    logSink = [];
    logger = silentLogger(logSink);
    db = (await initializeDatabase(
      { sqlitePath: join(cwd, 'app.db'), dataDir: cwd } as never,
      logger
    )) as SqliteDatabaseHandle;
    await runMigrations(db, logger);
    const now = Date.now();
    db.sqlite
      .prepare(
        `INSERT INTO accounts (id, email, plan, stripe_customer_id, created_at, updated_at)
         VALUES (?, ?, 'free', ?, ?, ?)`
      )
      .run(ACCOUNT_ID, 'tax@example.test', CUSTOMER_ID, now, now);
    store = new BillingStore(db);
  });

  afterEach(async () => {
    await db.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  /** Captures what the route asks Stripe for, without any network. */
  function appWith(createImpl: (params: unknown) => Promise<unknown>) {
    const calls: unknown[] = [];
    const stripe = {
      checkout: {
        sessions: {
          create: (params: unknown) => {
            calls.push(params);
            return createImpl(params);
          },
        },
      },
      billingPortal: { sessions: { create: async () => ({ url: 'https://portal' }) } },
      customers: { create: async () => ({ id: CUSTOMER_ID }) },
    } as unknown as Stripe;

    const app = new Hono();
    registerBillingDashboardRoutes(app as never, {
      config: { baseUrl: 'https://app.test' } as AppConfig,
      billing: billingConfig,
      store,
      stripe,
      logger,
      resolveAccount: async () => ({ id: ACCOUNT_ID, email: 'tax@example.test' }),
    });
    return { app, calls };
  }

  async function post(app: Hono, interval = 'monthly') {
    return app.request('/dashboard/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ interval }),
    });
  }

  it('enables Stripe Tax and collects everything needed to compute VAT', async () => {
    const { app, calls } = appWith(async () => ({ url: 'https://checkout.stripe.com/x' }));
    await post(app);

    const params = calls[0] as Record<string, unknown>;
    expect(params.automatic_tax).toEqual({ enabled: true });
    // VAT is charged at the CUSTOMER's rate, so an address is mandatory, not optional.
    expect(params.billing_address_collection).toBe('required');
    expect(params.tax_id_collection).toEqual({ enabled: true });
    // Required by Stripe whenever automatic_tax runs against a pre-existing customer.
    expect(params.customer_update).toEqual({ address: 'auto', name: 'auto' });
  });

  it('asks for terms-of-service consent on the first attempt', async () => {
    const { app, calls } = appWith(async () => ({ url: 'https://checkout.stripe.com/x' }));
    await post(app);

    expect((calls[0] as Record<string, unknown>).consent_collection).toEqual({
      terms_of_service: 'required',
    });
  });

  /**
   * The account has Managed Payments enabled, which rejects `custom_text` outright. Sending it
   * would fail every checkout, so it must not be in the params at all.
   */
  it('never sends custom_text, which Managed Payments rejects', async () => {
    const { app, calls } = appWith(async () => ({ url: 'https://checkout.stripe.com/x' }));
    await post(app);

    expect((calls[0] as Record<string, unknown>).custom_text).toBeUndefined();
  });

  /**
   * The important one. The Terms URL is a Dashboard setting that cannot be written through the API
   * on a first-party account, so the integration cannot guarantee it exists — and sending
   * consent_collection without it fails the session. A customer must still be able to pay.
   */
  it('retries WITHOUT consent when the Dashboard has no Terms URL, and still returns a session', async () => {
    let attempt = 0;
    const { app, calls } = appWith(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error(
          'You cannot collect consent to your terms of service unless a URL is set in the Stripe Dashboard.'
        );
      }
      return { url: 'https://checkout.stripe.com/fallback' };
    });

    const response = await post(app);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://checkout.stripe.com/fallback');
    expect(calls).toHaveLength(2);
    // The retry drops consent but keeps every tax parameter.
    const retry = calls[1] as Record<string, unknown>;
    expect(retry.consent_collection).toBeUndefined();
    expect(retry.automatic_tax).toEqual({ enabled: true });
  });

  it('logs the dropped consent loudly rather than skipping it silently', async () => {
    let attempt = 0;
    const { app } = appWith(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error(
          'You cannot collect consent to your terms of service unless a URL is set in the Stripe Dashboard.'
        );
      }
      return { url: 'https://checkout.stripe.com/fallback' };
    });

    await post(app);
    expect(logSink.join('')).toContain('tos_consent_unavailable');
  });

  /** Any OTHER Stripe failure must not be swallowed by the terms fallback. */
  it('does not retry on an unrelated Stripe error', async () => {
    const { app, calls } = appWith(async () => {
      throw new Error('Your card was declined.');
    });

    const response = await post(app);

    expect(calls).toHaveLength(1);
    expect(response.headers.get('location')).toContain('billing=error');
  });

  it('ships inclusive VAT pricing', () => {
    // €9 is what the customer pays; VAT is carved out of it. Flipping this is a revenue decision
    // and requires re-running the product setup script, because prices are immutable.
    expect(PRO_TAX_BEHAVIOR).toBe('inclusive');
  });
});
