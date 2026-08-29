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

  describe('the coming-soon flag and its waitlist', () => {
    const load = (env: Record<string, string>) => {
      const cwd = mkdtempSync(join(tmpdir(), 'aa-config-'));
      try {
        return loadConfig(
          {
            DEPLOYMENT: 'self-hosted',
            BASE_URL: 'http://localhost:3000',
            AA_SQLITE_PATH: './data/app.db',
            ...env,
          },
          { cwd }
        );
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    };

    it('is off unless a deployment asks for it', () => {
      expect(load({}).comingSoon).toBe(false);
      expect(load({ AA_COMING_SOON: 'true' }).comingSoon).toBe(true);
      expect(load({ AA_COMING_SOON: '1' }).comingSoon).toBe(true);
      expect(load({ AA_COMING_SOON: 'off' }).comingSoon).toBe(false);
    });

    it('reads the audience and its key as separate settings from the sending key', () => {
      const config = load({
        RESEND_API_KEY: 'send_only',
        RESEND_AUDIENCE_ID: 'aud_1',
        RESEND_AUDIENCE_API_KEY: 'full_access',
      });

      // The transactional path keeps the send-only key; only the waitlist holds the audience one.
      expect(config.mail.resendApiKey).toBe('send_only');
      expect(config.waitlist.audienceId).toBe('aud_1');
      expect(config.waitlist.apiKey).toBe('full_access');
      expect(config.waitlist.from).toBe('Agent Artifacts <hello@agentartifact.ai>');
      expect(config.waitlist.confirmation).toBe(true);
    });

    it('refuses to boot with half a waitlist configured', () => {
      // Half the pair is an instance whose form accepts addresses and stores none of them, which
      // is the one failure a signup form must never have.
      expect(() => load({ RESEND_AUDIENCE_ID: 'aud_1' })).toThrow(ConfigError);
      expect(() => load({ RESEND_AUDIENCE_API_KEY: 'full_access' })).toThrow(ConfigError);
      expect(() =>
        load({ RESEND_AUDIENCE_ID: 'aud_1', RESEND_AUDIENCE_API_KEY: 'full_access' })
      ).not.toThrow();
    });
  });
});
