const DEFAULT_RENDER_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export interface LruCacheOptions<TValue> {
  maxBytes?: number;
  maxEntries?: number;
  sizeOf?: (value: TValue) => number;
}

export interface LruCacheStats {
  entries: number;
  bytes: number;
  maxBytes: number;
  maxEntries?: number;
}

interface LruEntry<TValue> {
  value: TValue;
  bytes: number;
}

export class LruCache<TValue> {
  readonly maxBytes: number;
  readonly maxEntries?: number;

  #bytes = 0;
  #entries = new Map<string, LruEntry<TValue>>();
  #sizeOf: (value: TValue) => number;

  constructor(options: LruCacheOptions<TValue> = {}) {
    const maxBytes = options.maxBytes ?? DEFAULT_RENDER_CACHE_MAX_BYTES;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new Error('LruCache maxBytes must be a positive safe integer');
    }

    if (options.maxEntries !== undefined) {
      if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries <= 0) {
        throw new Error('LruCache maxEntries must be a positive safe integer when provided');
      }
      this.maxEntries = options.maxEntries;
    }

    this.maxBytes = maxBytes;
    this.#sizeOf = options.sizeOf ?? defaultSizeOf;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  has(key: string): boolean {
    return this.#entries.has(key);
  }

  get(key: string): TValue | undefined {
    const entry = this.#entries.get(key);
    if (!entry) {
      return undefined;
    }

    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: TValue): boolean {
    const bytes = this.#safeSizeOf(value);

    const existing = this.#entries.get(key);
    if (existing) {
      this.#entries.delete(key);
      this.#bytes -= existing.bytes;
    }

    if (bytes > this.maxBytes) {
      this.#evictUntilWithinLimits();
      return false;
    }

    this.#entries.set(key, { value, bytes });
    this.#bytes += bytes;
    this.#evictUntilWithinLimits();
    return this.#entries.has(key);
  }

  getOrSet(key: string, factory: () => TValue): TValue {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = factory();
    this.set(key, value);
    return value;
  }

  async getOrSetAsync(key: string, factory: () => Promise<TValue>): Promise<TValue> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await factory();
    this.set(key, value);
    return value;
  }

  delete(key: string): boolean {
    const entry = this.#entries.get(key);
    if (!entry) {
      return false;
    }

    this.#entries.delete(key);
    this.#bytes -= entry.bytes;
    return true;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }

  stats(): LruCacheStats {
    const stats: LruCacheStats = {
      entries: this.#entries.size,
      bytes: this.#bytes,
      maxBytes: this.maxBytes,
    };

    if (this.maxEntries !== undefined) {
      stats.maxEntries = this.maxEntries;
    }

    return stats;
  }

  #safeSizeOf(value: TValue): number {
    const bytes = this.#sizeOf(value);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new Error('LruCache sizeOf must return a non-negative safe integer');
    }
    return bytes;
  }

  #evictUntilWithinLimits(): void {
    while (this.#bytes > this.maxBytes || this.#exceedsMaxEntries()) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.delete(oldest.value);
    }
  }

  #exceedsMaxEntries(): boolean {
    return this.maxEntries !== undefined && this.#entries.size > this.maxEntries;
  }
}

export function defaultSizeOf(value: unknown): number {
  if (typeof value === 'string') {
    return Buffer.byteLength(value, 'utf8');
  }

  if (Buffer.isBuffer(value)) {
    return value.byteLength;
  }

  if (value instanceof Uint8Array) {
    return value.byteLength;
  }

  return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
}

export function createRenderCache<TValue>(options: LruCacheOptions<TValue> = {}): LruCache<TValue> {
  return new LruCache<TValue>({
    maxBytes: DEFAULT_RENDER_CACHE_MAX_BYTES,
    ...options,
  });
}

export const MARKDOWN_RENDER_CACHE_MAX_BYTES = DEFAULT_RENDER_CACHE_MAX_BYTES;
