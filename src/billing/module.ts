import type { Hono } from 'hono';
import type Stripe from 'stripe';
import type { BillingConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type {
  Account,
  CloudModule,
  NavItem,
  Plan,
  QuotaAction,
  QuotaDecision,
} from '../extension/cloud-module.js';
import type { Logger } from '../logger.js';
import { type PlanId, planShape, toCloudPlan } from './plans.js';
import { createStripeClient, registerStripeWebhookRoute } from './routes.js';
import { type BillingState, BillingStore } from './store.js';

export interface BillingModuleOptions {
  db: DatabaseHandle;
  config: BillingConfig;
  logger: Logger;
  /** Injectable for tests, which must never reach the network. */
  stripe?: Stripe;
}

/**
 * The paid-plan implementation of `CloudModule`.
 *
 * Deliberately shaped to the existing extension interface rather than bolted alongside it, so that
 * lifting this into the private `@agentartifact/cloud` package later is a move rather than a
 * rewrite: nothing outside this directory imports it by name, and `createApp` only ever sees a
 * `CloudModule`.
 */
export class BillingModule implements CloudModule {
  private readonly store: BillingStore;
  private readonly config: BillingConfig;
  private readonly logger: Logger;
  private readonly stripe: Stripe;

  constructor(options: BillingModuleOptions) {
    this.store = new BillingStore(options.db);
    this.config = options.config;
    this.logger = options.logger;
    this.stripe = options.stripe ?? createStripeClient(options.config);
  }

  get billingStore(): BillingStore {
    return this.store;
  }

  get stripeClient(): Stripe {
    return this.stripe;
  }

  get billingConfig(): BillingConfig {
    return this.config;
  }

  /**
   * Entitlement, resolved from a LOCAL read. Never calls Stripe.
   *
   * This runs on every dashboard page load and every public artifact view, so a network round trip
   * here would put Stripe's availability on the critical path of rendering a public page. The
   * `accounts.plan` column is the cache; webhooks keep it fresh.
   *
   * Precedence is comp > stored plan, and it is one-directional: `comp_plan` can only ever be read
   * here, never written by the webhook path, so an operator grant cannot be revoked by Stripe.
   */
  async resolvePlan(account: Account): Promise<Plan> {
    const state = await this.store.findByAccountId(account.id);
    if (!state) {
      // No row is not an expected state, but the safe answer is the free shape with unlimited
      // retention: refusing to delete data we cannot classify is always the right failure.
      return toCloudPlan(planShape('free'), null);
    }

    const effective = effectivePlan(state);
    return toCloudPlan(planShape(effective), this.resolveRetentionDays(state, effective));
  }

  /**
   * How long this account's artifacts live. `null` means forever.
   *
   * This states the POLICY. Whether the policy is acted on is a separate decision made by the
   * background sweep, which refuses to delete anything until `AA_RETENTION_ENFORCEMENT_ENABLED` is
   * armed. Keeping the two apart is deliberate: if this method returned `null` while enforcement was
   * off, the sweep could not report what it WOULD remove, and the dry-run — the whole mechanism for
   * measuring the blast radius before accepting it — would have nothing to count.
   *
   * Two reasons an account keeps its artifacts forever regardless:
   *
   *  1. It is on PRO, or an operator COMPED it — it has permanence either way.
   *  2. It is GRANDFATHERED — it existed before the 7-day window was published, and a pricing change
   *     must not reach backwards and delete what someone already published under different terms.
   */
  private resolveRetentionDays(state: BillingState, effective: PlanId): number | null {
    if (effective === 'pro') {
      return null;
    }
    if (state.grandfatheredAt !== null) {
      return null;
    }
    return this.config.freeRetentionDays;
  }

  /**
   * Password-protected shares are the one metered feature. Everything else is unlimited on both
   * tiers — neither plan caps artifact or bot counts.
   */
  async checkQuota(account: Account, action: QuotaAction): Promise<QuotaDecision> {
    if (action.type !== 'set_share_password') {
      return { allow: true };
    }

    const state = await this.store.findByAccountId(account.id);
    const effective = state ? effectivePlan(state) : 'free';
    if (planShape(effective).allowSharePassword) {
      return { allow: true };
    }

    return {
      allow: false,
      code: 'plan_upgrade_required',
      message: 'Password-protected shares are a Pro feature. Upgrade to protect this link.',
    };
  }

  /**
   * Mounts the webhook only. The two session-authenticated endpoints are registered from
   * `registerHumanRoutes`, where the dashboard's session machinery already lives — this hook runs
   * before that and has no way to validate a cookie.
   */
  registerRoutes(app: Parameters<NonNullable<CloudModule['registerRoutes']>>[0]): void {
    registerStripeWebhookRoute(app as unknown as Hono<never>, {
      billing: this.config,
      store: this.store,
      stripe: this.stripe,
      logger: this.logger,
    });
  }

  navItems(_account: Account): NavItem[] {
    // The billing section lives inside the existing settings page rather than as its own nav entry,
    // so there is nothing to add here. Kept explicit so the interface stays fully implemented.
    return [];
  }

  onArtifactEvent(): void {
    // No metering: neither plan limits counts, so artifact events carry no billing meaning.
  }
}

/**
 * Comp overrides everything. Used by `resolvePlan` and the quota check so the two can never
 * disagree about what an account is entitled to.
 */
export function effectivePlan(state: BillingState): PlanId {
  return state.compPlan ?? state.plan;
}
