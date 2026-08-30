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

/**
 * The share the hero is built from when a deployment does not name its own. It lives here rather
 * than on the page because boot code (`src/index.ts`) has to know which artifact to poll before
 * any page renders, and boot should depend on a service, never on a UI module.
 *
 * It is a DEFAULT, not a constant, because it is an artifact id: a row in one particular database.
 * Hard-coded, it made every other deployment poll — and link to — a share that only exists on the
 * instance it was seeded on. `AA_HERO_ARTIFACT_PATH` names the local one; empty means there is no
 * hero artifact here, and everything downstream is expected to fall silent rather than guess.
 */
export const DEFAULT_HERO_ARTIFACT_PATH = '/a/KbLJ0zvyiGadXLHUs2E5Rb';

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

/**
 * Public URL of an artifact served by the paired public instance.
 *
 * The cloud host and the public host are the same name with a `-cloud` suffix, so the artifact a
 * cloud page links to lives one hostname over. This is deployment topology expressed as a string
 * substitution and it deserves a config value instead; it is kept in one place here so there is a
 * single site to change when it gets one.
 */
export function publicArtifactUrl(baseUrl: string, artifactPath: string): string {
  const url = new URL(baseUrl);
  url.hostname = url.hostname.replace('-cloud.', '.');
  return `${url.origin}${artifactPath}`;
}

/**
 * Public URL of the artifact the marketing hero card is built from, or `null` when this
 * deployment has none configured. Callers render nothing rather than pointing at a 404.
 */
export function heroArtifactUrl(
  baseUrl: string,
  heroArtifactPath: string = DEFAULT_HERO_ARTIFACT_PATH
): string | null {
  const path = heroArtifactPath.trim();
  if (!path) {
    return null;
  }
  return publicArtifactUrl(baseUrl, path);
}

/** The deployment facts that decide whether a hero artifact is worth polling. */
export interface HeroArtifactPollConfig {
  deployment: string;
  comingSoon: boolean;
  baseUrl: string;
  heroArtifactPath: string;
}

/**
 * The URL boot should poll, or `null` when this deployment must not poll at all.
 *
 * Three separate reasons to stay quiet, which is why they are gathered into one answer rather than
 * left as three conditions at the call site:
 *
 *  - Only cloud serves the marketing homepage, so only cloud has a hero.
 *  - The coming-soon homepage never reads the snapshot, so filling it is pure noise.
 *  - No configured artifact means there is nothing here to poll.
 *
 * Getting this wrong is not free: the poller ran against a hard-coded share that exists on one
 * instance, so every other deployment spent boot and every 15 minutes after it fetching a 404 and
 * logging the warning.
 */
export function heroArtifactPollUrl(config: HeroArtifactPollConfig): string | null {
  if (config.deployment !== 'cloud' || config.comingSoon) {
    return null;
  }

  return heroArtifactUrl(config.baseUrl, config.heroArtifactPath);
}

/** The public poll surface for an artifact page URL. `poll=1` never counts a view. */
export function liveArtifactMetaUrl(artifactUrl: string): string {
  return `${artifactUrl}/content?poll=1`;
}

/**
 * Returns the cached snapshot when it is recent enough to be trustworthy, otherwise
 * `null`. Callers render nothing rather than guessing.
 */
export function getLiveArtifactMeta(
  artifactUrl: string | null,
  now: number = Date.now()
): LiveArtifactMeta | null {
  if (!artifactUrl || !cache || cache.artifactUrl !== artifactUrl) {
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
  artifactUrl: string | null,
  options: LiveArtifactMetaOptions = {}
): Promise<LiveArtifactMeta | null> {
  if (!artifactUrl) {
    return null;
  }

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
  artifactUrl: string | null,
  options: LiveArtifactMetaOptions & { intervalMs?: number } = {}
): LiveArtifactMetaRefresher {
  // No artifact, no timer — not even a first fetch. The guard lives here as well as at the call
  // site because "there is nothing to poll" is a fact about this module, and a caller that forgets
  // to ask should get silence rather than a 404 every quarter of an hour.
  if (!artifactUrl) {
    return { stop: () => {} };
  }

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
