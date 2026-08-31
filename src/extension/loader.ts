import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import type { Logger } from '../logger.js';
import type { CloudModule } from './cloud-module.js';
import { createDefaultCloudModule } from './default-module.js';

const functionField = z.custom<(...args: unknown[]) => unknown>(
  (value) => typeof value === 'function'
);

const cloudModuleSchema = z
  .object({
    init: functionField.optional(),
    resolvePlan: functionField,
    checkQuota: functionField,
    registerRoutes: functionField.optional(),
    navItems: functionField.optional(),
    onArtifactEvent: functionField.optional(),
  })
  .passthrough();

export class CloudModuleLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CloudModuleLoadError';
  }
}

export async function loadCloudModule(
  config: AppConfig,
  ctx?: { db: DatabaseHandle; logger: Logger }
): Promise<CloudModule> {
  const cloudModule = await selectModule(config, ctx);

  const parsed = cloudModuleSchema.safeParse(cloudModule);
  if (!parsed.success) {
    throw new CloudModuleLoadError(
      `Cloud module interface mismatch: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`
    );
  }

  if (cloudModule.init && ctx) {
    await cloudModule.init({ ...ctx, config });
  }

  return cloudModule;
}

/**
 * Which implementation of the plan/quota seam this deployment runs.
 *
 * Precedence, most specific first:
 *  1. `AA_CLOUD_MODULE` — an explicitly configured external module is the operator's override and
 *     wins outright, so the private cloud package can replace billing wholesale later.
 *  2. `AA_BILLING_ENABLED` — the in-core Stripe implementation.
 *  3. The default free/self-host module, which is what every OSS install gets.
 *
 * Billing needs a database, so an instance without one falls through to the default rather than
 * constructing a module that cannot read the plan column.
 */
async function selectModule(
  config: AppConfig,
  ctx?: { db: DatabaseHandle; logger: Logger }
): Promise<CloudModule> {
  if (config.aaCloudModule) {
    return importConfiguredModule(config.aaCloudModule);
  }

  if (config.billing && ctx?.db) {
    // Imported lazily so that an OSS build with billing off never pulls the Stripe SDK into the
    // module graph at boot.
    const { BillingModule } = await import('../billing/module.js');
    ctx.logger.info(
      { retention_enforcement: config.billing.retentionEnforcementEnabled },
      'billing.module.enabled'
    );
    return new BillingModule({ db: ctx.db, config: config.billing, logger: ctx.logger });
  }

  return createDefaultCloudModule(config);
}

async function importConfiguredModule(specifier: string): Promise<CloudModule> {
  try {
    const loaded = (await import(specifier)) as { default?: unknown };
    if (!loaded.default || typeof loaded.default !== 'object') {
      throw new CloudModuleLoadError('Cloud module must default-export an object');
    }
    return loaded.default as CloudModule;
  } catch (error) {
    if (error instanceof CloudModuleLoadError) {
      throw error;
    }
    throw new CloudModuleLoadError(`Failed to load cloud module: ${specifier}`, {
      cause: error,
    });
  }
}
