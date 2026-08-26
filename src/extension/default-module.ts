import type { AppConfig } from '../config.js';
import type { CloudModule, Plan } from './cloud-module.js';

export function createDefaultCloudModule(config: Pick<AppConfig, 'aaHideFooter'>): CloudModule {
  const ossPlan: Plan = {
    id: 'oss',
    name: 'Self-hosted',
    showFooter: !config.aaHideFooter,
    limits: { maxBots: null, maxArtifacts: null },
    artifact_retention_days: null,
  };

  return {
    resolvePlan: async () => ossPlan,
    checkQuota: async () => ({ allow: true }),
  };
}

export const defaultCloudModule = createDefaultCloudModule({ aaHideFooter: false });
