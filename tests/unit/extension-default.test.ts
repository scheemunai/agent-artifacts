import { describe, expect, it } from 'vitest';
import { createDefaultCloudModule } from '../../src/extension/default-module.js';

const account = { id: 'acc_test', email: 'agent@example.test', suspendedAt: null };

describe('defaultCloudModule', () => {
  it('returns the OSS unlimited plan and allows create_version', async () => {
    const module = createDefaultCloudModule({ aaHideFooter: true });

    await expect(module.resolvePlan(account)).resolves.toEqual({
      id: 'oss',
      name: 'Self-hosted',
      showFooter: false,
      limits: { maxBots: null, maxArtifacts: null },
      artifact_retention_days: null,
    });
    await expect(
      module.checkQuota(account, {
        type: 'create_version',
        artifact_id: 'art_example',
        content_bytes: 42,
      })
    ).resolves.toEqual({ allow: true });
  });
});
