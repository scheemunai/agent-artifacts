import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('auto-generates a self-host session secret with mode 0600', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'aa-config-'));

    try {
      const config = loadConfig(
        {
          DEPLOYMENT: 'self-hosted',
          BASE_URL: 'http://localhost:3000',
          AA_SQLITE_PATH: './data/app.db',
        },
        { cwd }
      );

      expect(config.sessionSecret).toHaveLength(43);
      expect(config.sessionSecretPath).toBe(join(cwd, 'data', '.session-secret'));
      const sessionSecretPath = config.sessionSecretPath;
      if (!sessionSecretPath) {
        throw new Error('expected session secret path');
      }
      expect(statSync(sessionSecretPath).mode & 0o777).toBe(0o600);

      const reloaded = loadConfig(
        {
          DEPLOYMENT: 'self-hosted',
          BASE_URL: 'http://localhost:3000',
          AA_SQLITE_PATH: './data/app.db',
        },
        { cwd }
      );
      expect(reloaded.sessionSecret).toBe(config.sessionSecret);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('requires cloud-only boot dependencies in cloud mode', () => {
    expect(() => loadConfig({ DEPLOYMENT: 'cloud' })).toThrow(ConfigError);
  });
});
