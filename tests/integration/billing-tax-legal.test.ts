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
import { createWebRoute } from '../../src/routes/web.js';
import {
  LEGAL_DOCUMENTS,
  LEGAL_SLUGS,
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
    expect(LEGAL_SLUGS.sort()).toEqual(['privacy', 'refund-policy', 'terms']);
  });

  it('resolves a known slug and refuses an unknown one', () => {
    expect(legalDocument('terms')?.title).toBe('Terms of Service');
    expect(legalDocument('not-a-document')).toBeUndefined();
  });

  it('renders every document with the publish date and cross-links to the other two', () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      const html = String(LegalPage({ document }));
      // The renderer escapes, so compare against the escaped title ("Refund &amp; Cancellation").
      expect(html).toContain(document.title.replaceAll('&', '&amp;'));
      expect(html).toContain('30 August 2026');
      expect(html).toContain('href="/terms"');
      expect(html).toContain('href="/refund-policy"');
      expect(html).toContain('href="/privacy"');
    }
  });

  /**
   * The operating entity has to appear on the pages that create obligations. A Terms page that
   * never names the company behind it is not a contract anyone can rely on, and an EU seller must
   * state its VAT identity.
   */
  it('names the operating entity and VAT number on every page footer', () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      const html = String(LegalPage({ document }));
      expect(html).toContain('Zero Point Studio d.o.o.');
      expect(html).toContain('HR52438945902');
      expect(html).toContain('Rudeška cesta 179');
    }
  });

  it('carries no unreplaced content placeholders', () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      const html = String(LegalPage({ document }));
      expect(html).not.toContain('[PUBLISH DATE]');
      expect(html).not.toContain('[Company legal name]');
      expect(html).not.toMatch(/\[[A-Z][a-z]+ [a-z ]+\]/);
      expect(html).not.toContain('placeholder pending final legal text');
    }
  });

  it('renders **bold** as emphasis rather than printing the asterisks', () => {
    const terms = String(LegalPage({ document: legalDocument('terms') as LegalDocument }));
    expect(terms).toContain('<strong>Who we are.</strong>');
    expect(terms).not.toContain('**');
  });

  it('states the Croatian governing law and the price the product actually charges', () => {
    const terms = String(LegalPage({ document: legalDocument('terms') as LegalDocument }));
    expect(terms).toContain('governed by the laws of');
    expect(terms).toContain('Croatia');
    // If the pricing card and the Terms disagree about the price, the Terms are the problem.
    expect(terms).toContain('€9/month or €90/year');
  });

  /**
   * The refund policy has to match what the code does. `cancel_at_period_end` keeps access to the
   * end of the paid period, so a policy claiming immediate termination would be false.
   */
  it('describes cancellation the way the billing code actually behaves', () => {
    const refunds = String(
      LegalPage({ document: legalDocument('refund-policy') as LegalDocument })
    );
    expect(refunds).toContain('end of your current billing period');
    expect(refunds).toContain('you keep Pro access until then');
    expect(refunds).toContain('handled by Stripe');
  });

  it('privacy policy reflects that card data never reaches our servers', () => {
    const privacy = String(LegalPage({ document: legalDocument('privacy') as LegalDocument }));
    expect(privacy).toContain('never full card numbers');
    expect(privacy).toContain('GDPR');
    expect(privacy).toContain('AZOP');
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

describe('legal routes in every deployment mode', () => {
  /**
   * There is no "coming-soon middleware" to exempt these from, and that is the point worth pinning
   * down: `AA_COMING_SOON` only changes what `/` renders. Every other route — legal, health, the
   * agent contract — is registered exactly as it always is, in `registerRemainingWebRoutes`, which
   * BOTH branches of `createWebRoute` call.
   *
   * The early `return web` for the launched case is the hazard this guards. If someone moved the
   * legal routes above it, or registered them in only one branch, a pre-launch host would answer
   * 404 for the very documents Stripe Checkout links to.
   */
  const baseConfig = {
    baseUrl: 'https://agentartifact.ai',
    deployment: 'cloud',
    heroArtifactPath: '',
    rateLimitsDisabled: true,
    sessionSecret: 'x'.repeat(32),
    trustProxy: 0,
    waitlist: { from: 'a@b.test', confirmation: false },
  } as unknown as AppConfig;

  for (const comingSoon of [false, true]) {
    it(`serves every legal page with AA_COMING_SOON=${comingSoon}`, async () => {
      const web = createWebRoute({ ...baseConfig, comingSoon } as AppConfig, silentLogger(), {
        waitlist: { subscribe: async () => 'subscribed' } as never,
      });

      for (const slug of LEGAL_SLUGS) {
        const response = await web.request(`/${slug}`);
        expect(response.status, `/${slug} with comingSoon=${comingSoon}`).toBe(200);
        expect(await response.text()).toContain('Zero Point Studio d.o.o.');
      }
    });
  }

  it('still 404s an unknown legal slug rather than rendering an empty document', async () => {
    const web = createWebRoute({ ...baseConfig, comingSoon: false } as AppConfig, silentLogger(), {
      waitlist: { subscribe: async () => 'subscribed' } as never,
    });
    expect((await web.request('/not-a-legal-page')).status).toBe(404);
  });
});
