import { describe, expect, it } from 'vitest';
import { InMemoryRateLimitStore } from '../../src/lib/rate-limit.js';

describe('InMemoryRateLimitStore.refund', () => {
  it('hands a token back to the live window and restates the remaining count', () => {
    const store = new InMemoryRateLimitStore();
    const now = 1_000_000;

    store.take('key', 10, 60_000, now);
    const second = store.take('key', 10, 60_000, now);
    expect(second.remaining).toBe(8);

    const refunded = store.refund('key', 10, now);
    expect(refunded).toMatchObject({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetAt: now + 60_000,
    });
    expect(store.take('key', 10, 60_000, now).remaining).toBe(8);
  });

  it('gives a refunded caller its attempt back rather than its place in the queue', () => {
    const store = new InMemoryRateLimitStore();
    const now = 2_000_000;

    // A budget of one. Spend it, hand it back, spend it again: a refused attempt cost nothing.
    expect(store.take('key', 1, 60_000, now).allowed).toBe(true);
    expect(store.refund('key', 1, now)?.remaining).toBe(1);
    expect(store.take('key', 1, 60_000, now).allowed).toBe(true);

    // But a refund is one token, not an amnesty: the caller is still at its limit.
    expect(store.take('key', 1, 60_000, now).allowed).toBe(false);
    store.refund('key', 1, now);
    expect(store.take('key', 1, 60_000, now).allowed).toBe(false);
  });

  it('refunds nothing for an unknown key, an empty bucket, or an expired window', () => {
    const store = new InMemoryRateLimitStore();
    const now = 3_000_000;

    expect(store.refund('never-seen', 10, now)).toBeNull();

    store.take('key', 10, 60_000, now);
    expect(store.refund('key', 10, now)).not.toBeNull();
    // The bucket is empty now; a second refund must not mint credit out of nothing.
    expect(store.refund('key', 10, now)).toBeNull();

    store.take('rolled', 10, 60_000, now);
    // The window is gone, and so is the token that was spent inside it.
    expect(store.refund('rolled', 10, now + 60_001)).toBeNull();
    expect(store.take('rolled', 10, 60_000, now + 60_001).remaining).toBe(9);
  });
});
