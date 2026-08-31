import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const FULL_KEYS = {
  STRIPE_SECRET_KEY: 'sk_test_abc123',
  STRIPE_WEBHOOK_SECRET: 'whsec_abc123',
  STRIPE_PRICE_PRO_MONTHLY: 'price_monthly',
  STRIPE_PRICE_PRO_ANNUAL: 'price_annual',
};

describe('billing config', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'aa-config-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function load(env: Record<string, string>) {
    return loadConfig(
      {
        DEPLOYMENT: 'self-hosted',
        BASE_URL: 'http://localhost:3000',
        AA_SQLITE_PATH: './data/app.db',
        ...env,
      },
      { cwd }
    );
  }

  it('is absent by default — a self-host renders no billing at all', () => {
    expect(load({}).billing).toBeUndefined();
  });

  it('stays absent when keys are present but the flag is off', () => {
    // Staging secrets ahead of a go-live that has not been flipped yet is a valid state.
    expect(load(FULL_KEYS).billing).toBeUndefined();
  });

  it('is populated when enabled with a complete key set', () => {
    const config = load({ ...FULL_KEYS, AA_BILLING_ENABLED: 'true' });
    expect(config.billing).toMatchObject({
      webhookSecret: 'whsec_abc123',
      priceProMonthly: 'price_monthly',
      priceProAnnual: 'price_annual',
      freeRetentionDays: 7,
      retentionEnforcementEnabled: false,
    });
  });

  it('refuses to boot when enabled with a missing key', () => {
    for (const omitted of Object.keys(FULL_KEYS)) {
      const partial = { ...FULL_KEYS, AA_BILLING_ENABLED: 'true' } as Record<string, string>;
      delete partial[omitted];
      expect(() => load(partial), `omitting ${omitted} should fail boot`).toThrow(ConfigError);
    }
  });

  it('refuses a TEST key on a production-looking origin', () => {
    expect(() =>
      load({
        ...FULL_KEYS,
        AA_BILLING_ENABLED: 'true',
        BASE_URL: 'https://agentartifact.ai',
      })
    ).toThrow(/TEST key but BASE_URL looks like production/);
  });

  it('refuses a LIVE key on a non-production origin', () => {
    expect(() =>
      load({
        ...FULL_KEYS,
        STRIPE_SECRET_KEY: 'sk_live_realmoney',
        AA_BILLING_ENABLED: 'true',
        BASE_URL: 'http://localhost:3000',
      })
    ).toThrow(/LIVE key but BASE_URL is not a production https origin/);
  });

  it('accepts a LIVE key on a production origin', () => {
    const config = load({
      ...FULL_KEYS,
      STRIPE_SECRET_KEY: 'sk_live_realmoney',
      AA_BILLING_ENABLED: 'true',
      BASE_URL: 'https://agentartifact.ai',
      SESSION_SECRET: 'x'.repeat(32),
    });
    expect(config.billing?.secretKey.startsWith('sk_live_')).toBe(true);
  });

  it('rejects a key that is neither test nor live', () => {
    expect(() =>
      load({ ...FULL_KEYS, STRIPE_SECRET_KEY: 'rk_restricted_key', AA_BILLING_ENABLED: 'true' })
    ).toThrow(/must start with sk_test_ or sk_live_/);
  });

  it('keeps retention enforcement off unless explicitly armed', () => {
    const off = load({ ...FULL_KEYS, AA_BILLING_ENABLED: 'true' });
    const on = load({
      ...FULL_KEYS,
      AA_BILLING_ENABLED: 'true',
      AA_RETENTION_ENFORCEMENT_ENABLED: 'true',
    });

    expect(off.billing?.retentionEnforcementEnabled).toBe(false);
    expect(on.billing?.retentionEnforcementEnabled).toBe(true);
  });
});
