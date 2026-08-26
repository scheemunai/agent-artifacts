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
  const cloudModule = config.aaCloudModule
    ? await importConfiguredModule(config.aaCloudModule)
    : createDefaultCloudModule(config);

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
