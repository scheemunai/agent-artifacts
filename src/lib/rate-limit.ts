import type { Context } from 'hono';
import { AppError } from './errors.js';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter: number;
}

export interface RateLimitStore {
  take(key: string, limit: number, windowMs: number, now?: number): RateLimitResult;
  reset(): void;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  take(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
    const existing = this.buckets.get(key);
    const bucket =
      existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    this.buckets.set(key, bucket);

    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining: Math.max(0, limit - bucket.count),
      resetAt: bucket.resetAt,
      retryAfter,
    };
  }

  reset(): void {
    this.buckets.clear();
  }
}

export const globalRateLimitStore = new InMemoryRateLimitStore();

export function enforceRateLimit(
  context: Context,
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
  headers = false
): RateLimitResult {
  const result = store.take(key, limit, windowMs);

  if (headers) {
    setRateLimitHeaders(context, result);
  }

  if (!result.allowed) {
    context.header('Retry-After', String(result.retryAfter));
    throw new AppError(429, 'rate_limited', 'Rate limit exceeded', {
      limit,
      retry_after: result.retryAfter,
    });
  }

  return result;
}

export function setRateLimitHeaders(context: Context, result: RateLimitResult): void {
  context.header('X-RateLimit-Limit', String(result.limit));
  context.header('X-RateLimit-Remaining', String(result.remaining));
  context.header('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
}

export function clientIp(context: Context, trustProxy: number): string {
  if (trustProxy > 0) {
    const forwardedFor = context.req.header('x-forwarded-for');
    if (forwardedFor) {
      const hops = forwardedFor
        .split(',')
        .map((hop) => hop.trim())
        .filter(Boolean);
      const index = Math.max(0, hops.length - trustProxy - 1);
      return hops[index] ?? hops[0] ?? 'unknown';
    }
  }

  return context.req.header('x-real-ip') ?? 'unknown';
}
