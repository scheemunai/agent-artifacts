import { describe, expect, it } from 'vitest';
import { type DashboardBillingView, DashboardSettingsPage } from '../../src/ui/pages/dashboard.js';
import { HomePage } from '../../src/ui/pages/home.js';

const account = { id: 'acc_ui', email: 'ui@example.test' };

function billing(overrides: Partial<DashboardBillingView> = {}): DashboardBillingView {
  return {
    plan: 'free',
    comped: false,
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasCustomer: false,
    paymentAttention: false,
    priceMonthly: '€9',
    priceAnnual: '€90',
    ...overrides,
  };
}

function settings(view?: DashboardBillingView): string {
  return String(
    DashboardSettingsPage({
      account,
      deployment: 'cloud',
      ...(view ? { billing: view } : {}),
    })
  );
}

describe('marketing pricing card', () => {
  const html = String(HomePage({ baseUrl: 'https://agentartifact.ai', authenticated: false }));

  it('prices Pro in EUR, matching the account currency', () => {
    expect(html).toContain('€9');
    expect(html).toContain('€90');
    // The old mockup priced it in dollars against a EUR Stripe account.
    expect(html).not.toContain('$9');
  });

  it('labels the unbuilt subdomain feature as coming soon', () => {
    // The card may carry the roadmap, but checkout must not imply the feature is included today.
    expect(html).toContain('Your own subdomain (coming soon)');
  });

  it('states the free tier retention and the Pro promises', () => {
    expect(html).toContain('Artifacts live 7 days');
    expect(html).toContain('Artifacts live forever');
    expect(html).toContain('No footer but yours');
    expect(html).toContain('Password-protected shares');
  });
});

describe('dashboard billing card', () => {
  it('renders nothing at all when billing is not configured', () => {
    const html = settings();
    // A self-host must not show an upgrade button, because there is no endpoint behind it.
    expect(html).not.toContain('Billing');
    expect(html).not.toContain('/dashboard/api/billing/checkout');
  });

  it('offers both intervals to a free account, posting to our own endpoint', () => {
    const html = settings(billing());
    expect(html).toContain('Upgrade to Pro — €9/month');
    expect(html).toContain('Upgrade yearly — €90/year');
    // CSP sets form-action 'self': a form targeting checkout.stripe.com would be blocked outright.
    expect(html).toContain('action="/dashboard/api/billing/checkout"');
    expect(html).not.toContain('checkout.stripe.com');
    expect(html).toContain('name="interval" value="monthly"');
    expect(html).toContain('name="interval" value="annual"');
  });

  it('hides the portal button until the account actually has a Stripe customer', () => {
    expect(settings(billing({ hasCustomer: false }))).not.toContain('Manage billing');
    expect(settings(billing({ hasCustomer: true }))).toContain('Manage billing');
  });

  it('shows a pro account its renewal date and no upgrade buttons', () => {
    const html = settings(
      billing({
        plan: 'pro',
        hasCustomer: true,
        currentPeriodEnd: Date.UTC(2026, 2, 14),
      })
    );
    expect(html).toContain('Renews on');
    expect(html).toContain('14 March 2026');
    expect(html).not.toContain('Upgrade to Pro');
  });

  it('tells a cancelling subscriber when access actually ends', () => {
    const html = settings(
      billing({
        plan: 'pro',
        hasCustomer: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: Date.UTC(2026, 2, 14),
      })
    );
    expect(html).toContain('set to cancel');
    expect(html).toContain('14 March 2026');
    expect(html).not.toContain('Renews on');
  });

  it('asks a past-due customer to act WITHOUT claiming access was removed', () => {
    const html = settings(
      billing({ plan: 'pro', hasCustomer: true, status: 'past_due', paymentAttention: true })
    );
    expect(html).toContain('did not go through');
    // Access is retained while Stripe's Smart Retries run; the copy must not say otherwise.
    expect(html).toContain('still active');
  });

  it('marks a comped account as complimentary rather than implying it pays', () => {
    const html = settings(billing({ plan: 'pro', comped: true }));
    expect(html).toContain('(complimentary)');
  });
});
