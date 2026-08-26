import { describe, expect, it } from 'vitest';
import type { CloudModule } from '../../src/extension/cloud-module.js';
import { ArtifactService } from '../../src/services/artifacts.js';
import { ServiceError, toErrorEnvelope } from '../../src/services/errors.js';
import { createMigratedSqliteContext } from './db-test-utils.js';

describe('CloudModule quota enforcement', () => {
  it('denies create_artifact before side effects and returns the quota error shape', async () => {
    const ctx = await createMigratedSqliteContext();
    const denyingModule: CloudModule = {
      resolvePlan: async () => ({
        id: 'test-deny',
        name: 'Test deny',
        showFooter: true,
        limits: { maxBots: 0, maxArtifacts: 0 },
        artifact_retention_days: null,
      }),
      checkQuota: async (_account, action) => {
        if (action.type === 'create_artifact') {
          return { allow: false, code: 'free_artifact_limit', message: 'Artifact limit reached' };
        }
        return { allow: true };
      },
    };
    const service = new ArtifactService({
      db: ctx.db,
      extension: denyingModule,
      baseUrl: 'https://example.test',
    });

    try {
      let caught: unknown;
      try {
        await service.upsertArtifact({
          account: ctx.account,
          slug: 'blocked',
          type: 'markdown',
          title: 'Blocked',
          content: '# Blocked',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ServiceError);
      expect(caught).toMatchObject({ status: 403, code: 'quota_exceeded' });
      expect(toErrorEnvelope(caught)).toEqual({
        error: {
          code: 'quota_exceeded',
          message: 'Artifact limit reached',
          details: { code: 'free_artifact_limit' },
        },
      });
      expect(ctx.db.sqlite.prepare('SELECT count(*) AS count FROM artifacts').get()).toEqual({
        count: 0,
      });
    } finally {
      await ctx.cleanup();
    }
  });
});
