import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The two primitives every signed URL token in this codebase is built from.
 *
 * They were private to `services/viewer.ts`, which mints the share-access token. The owner-preview
 * token needs exactly the same construction — HMAC-SHA256 over a canonical string, compared in
 * constant time — and the failure mode of copying six lines of comparison code is not a compile
 * error, it is a second, subtly weaker opinion about how to compare a MAC. One implementation, two
 * callers.
 */
export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Constant-time hex comparison. The length and charset guards run first because `Buffer.from` is
 * lenient about both — it truncates invalid hex silently, so two different strings can produce
 * equal buffers, and `timingSafeEqual` throws on a length mismatch rather than returning false.
 */
export function timingSafeEqualHex(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actual) || actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
