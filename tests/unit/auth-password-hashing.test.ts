import { describe, expect, it } from 'vitest';
import {
  ARGON2ID_PASSWORD_PARAMS,
  hashPassword,
  verifyPasswordIfHashExists,
} from '../../src/services/auth.js';
import { createPasswordHash } from '../../src/services/v1.js';

describe('account and share password hashing', () => {
  it('uses one explicit argon2id parameter set for account and share passwords', async () => {
    expect(ARGON2ID_PASSWORD_PARAMS).toMatchObject({
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const accountHash = await hashPassword('password123');
    const shareHash = await createPasswordHash('secret-pass');

    expect(accountHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(accountHash).toContain('m=19456');
    expect(accountHash).toContain('t=2');
    expect(accountHash).toContain('p=1');
    expect(shareHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(shareHash).toContain('m=19456');
    expect(shareHash).toContain('t=2');
    expect(shareHash).toContain('p=1');
    expect(await verifyPasswordIfHashExists(accountHash, 'password123')).toBe(true);
    expect(await verifyPasswordIfHashExists(shareHash, 'secret-pass')).toBe(true);
  });
});
