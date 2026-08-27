import { z } from 'zod';
import type { Logger } from '../logger.js';

/**
 * The marketing homepage frames its hero as a published artifact. That claim is only
 * true if the meta strip reports the artifact's real state, so this module keeps an
 * in-memory snapshot of the demo artifact refreshed over HTTP.
 *
 * The cloud instance cannot read the public instance's database, so the snapshot comes
 * from the public poll surface (`/a/<share_id>/content?poll=1`, which never counts a
 * view). Rendering never waits on the network: the page reads whatever snapshot exists
 * and omits the meta entirely when there is none.
 */

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
/** A snapshot older than this is dropped rather than shown: a stale label can lie. */
const SNAPSHOT_MAX_AGE_MS = 45 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4_000;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

const contentMetaSchema = z.object({
  latest_version_num: z.number().int().positive(),
  updated_at: z.string(),
});

export interface LiveArtifactMeta {
  /** Version chip copy, for example `v3`. */
  versionLabel: string;
  /** Artifact `updated_at`, epoch milliseconds. */
  updatedAt: number;
  /** When this snapshot was fetched, epoch milliseconds. */
  fetchedAt: number;
}

export interface LiveArtifactMetaOptions {
  fetchImpl?: typeof fetch;
  logger?: Logger;
  now?: () => number;
  timeoutMs?: number;
}

export interface LiveArtifactMetaRefresher {
  stop(): void;
}

interface CacheSlot {
  artifactUrl: string;
  meta: LiveArtifactMeta;
}

let cache: CacheSlot | null = null;
let inFlight: Promise<LiveArtifactMeta | null> | null = null;

/** The public poll surface for an artifact page URL. `poll=1` never counts a view. */
export function liveArtifactMetaUrl(artifactUrl: string): string {
  return `${artifactUrl}/content?poll=1`;
}

/**
 * Returns the cached snapshot when it is recent enough to be trustworthy, otherwise
 * `null`. Callers render nothing rather than guessing.
 */
export function getLiveArtifactMeta(
  artifactUrl: string,
  now: number = Date.now()
): LiveArtifactMeta | null {
  if (!cache || cache.artifactUrl !== artifactUrl) {
    return null;
  }

  if (now - cache.meta.fetchedAt > SNAPSHOT_MAX_AGE_MS) {
    return null;
  }

  return cache.meta;
}

/** Test seam: drops the cached snapshot. */
export function resetLiveArtifactMeta(): void {
  cache = null;
  inFlight = null;
}

/**
 * Fetches one snapshot. Never throws and never rejects: a failure leaves the previous
 * snapshot in place (it ages out on its own) and returns `null`.
 */
export async function refreshLiveArtifactMeta(
  artifactUrl: string,
  options: LiveArtifactMetaOptions = {}
): Promise<LiveArtifactMeta | null> {
  if (inFlight) {
    return inFlight;
  }

  const run = async (): Promise<LiveArtifactMeta | null> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const now = options.now ?? Date.now;
    const url = liveArtifactMetaUrl(artifactUrl);

    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs ?? FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        options.logger?.warn(
          { url, status: response.status },
          'home.live_artifact_meta.unavailable'
        );
        return null;
      }

      const parsed = contentMetaSchema.safeParse(await response.json());
      if (!parsed.success) {
        options.logger?.warn({ url }, 'home.live_artifact_meta.unexpected_shape');
        return null;
      }

      const updatedAt = Date.parse(parsed.data.updated_at);
      if (Number.isNaN(updatedAt)) {
        options.logger?.warn({ url }, 'home.live_artifact_meta.unexpected_shape');
        return null;
      }

      const meta: LiveArtifactMeta = {
        versionLabel: `v${parsed.data.latest_version_num}`,
        updatedAt,
        fetchedAt: now(),
      };
      cache = { artifactUrl, meta };
      options.logger?.debug({ url, version: meta.versionLabel }, 'home.live_artifact_meta.refresh');
      return meta;
    } catch (error) {
      options.logger?.warn({ err: error, url }, 'home.live_artifact_meta.failed');
      return null;
    }
  };

  inFlight = run().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/**
 * Boot-time fill plus a periodic refresh. The timer is unref'd so it never holds the
 * process open, matching the background scheduler's contract.
 */
export function startLiveArtifactMetaRefresh(
  artifactUrl: string,
  options: LiveArtifactMetaOptions & { intervalMs?: number } = {}
): LiveArtifactMetaRefresher {
  void refreshLiveArtifactMeta(artifactUrl, options);

  const timer = setInterval(() => {
    void refreshLiveArtifactMeta(artifactUrl, options);
  }, options.intervalMs ?? REFRESH_INTERVAL_MS);
  timer.unref?.();

  return {
    stop: () => {
      clearInterval(timer);
    },
  };
}

/**
 * Relative time for the artifact meta strip, for example `updated 6 h ago`.
 * Returns `null` when the timestamp cannot be described honestly.
 */
export function formatUpdatedLabel(updatedAt: number, now: number = Date.now()): string | null {
  if (!Number.isFinite(updatedAt)) {
    return null;
  }

  const elapsed = now - updatedAt;
  if (elapsed < -MINUTE_MS) {
    return null;
  }

  if (elapsed < MINUTE_MS) {
    return 'updated just now';
  }

  if (elapsed < HOUR_MS) {
    return `updated ${Math.floor(elapsed / MINUTE_MS)} min ago`;
  }

  if (elapsed < DAY_MS) {
    return `updated ${Math.floor(elapsed / HOUR_MS)} h ago`;
  }

  if (elapsed < MONTH_MS) {
    return `updated ${Math.floor(elapsed / DAY_MS)} d ago`;
  }

  return `updated ${Math.floor(elapsed / MONTH_MS)} mo ago`;
}
