import { describe, expect, it } from 'vitest';
import type { CloudModule, QuotaAction } from '../../src/extension/cloud-module.js';
import {
  countRows,
  createIntegrationTestContext,
  createLogCapture,
  json,
  testPlan,
} from '../support/integration-harness.js';

const jsonContent = { 'Content-Type': 'application/json' };

describe('fault injection harness', () => {
  it('QA-API-006/023 maps unexpected service failures to safe 500 envelopes and logs request id', async () => {
    const sentinel = 'SECRET_STACK_SENTINEL';
    const artifactContent = 'fault-harness-content-must-not-leak';
    const capture = createLogCapture();
    const faultingCloudModule: CloudModule = {
      resolvePlan: async () => testPlan(),
      checkQuota: async (_account, action: QuotaAction) => {
        if (action.type === 'create_artifact') {
          throw new Error(`${sentinel}: simulated storage failure near SELECT * FROM artifacts`);
        }
        return { allow: true };
      },
    };
    const ctx = await createIntegrationTestContext({
      cloudModule: faultingCloudModule,
      logger: capture.logger,
    });

    try {
      const response = await ctx.app.request('/v1/artifacts', {
        method: 'POST',
        headers: { ...ctx.authHeaders, ...jsonContent },
        body: JSON.stringify({
          slug: 'fault-injected',
          type: 'markdown',
          title: 'Fault Injected',
          content: artifactContent,
          share: true,
        }),
      });
      const body = await json(response);
      const bodyText = JSON.stringify(body);
      const requestId = response.headers.get('x-request-id');

      expect(response.status).toBe(500);
      expect(requestId).toMatch(/^req_[A-Za-z0-9_-]{12}$/);
      expect(body).toEqual({
        error: {
          code: 'internal_error',
          message: 'Internal server error',
          request_id: requestId,
        },
      });
      expect(bodyText).not.toContain(sentinel);
      expect(bodyText).not.toContain('SELECT');
      expect(bodyText).not.toContain('artifacts');
      expect(bodyText).not.toContain('Error:');
      expect(bodyText).not.toContain(artifactContent);
      expect(countRows(ctx, 'artifacts')).toBe(0);
      expect(countRows(ctx, 'artifact_versions')).toBe(0);
      expect(countRows(ctx, 'shares')).toBe(0);

      const requestErrorLog = capture
        .entries()
        .find((entry) => entry.msg === 'request.error' && entry.request_id === requestId);
      expect(requestErrorLog).toBeDefined();
      expect(JSON.stringify(requestErrorLog)).toContain(sentinel);
    } finally {
      await ctx.cleanup();
    }
  });
});
