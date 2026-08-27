import { afterEach, describe, expect, it } from 'vitest';
import {
  formatUpdatedLabel,
  getLiveArtifactMeta,
  liveArtifactMetaUrl,
  refreshLiveArtifactMeta,
  resetLiveArtifactMeta,
} from '../../src/services/live-artifact-meta.js';

const ARTIFACT_URL = 'https://example.test/a/KbLJ0zvyiGadXLHUs2E5Rb';
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  resetLiveArtifactMeta();
});

describe('live artifact meta', () => {
  it('polls the public content surface without counting a view', async () => {
    const seen: string[] = [];
    const fetchImpl = ((url: string) => {
      seen.push(url);
      return Promise.resolve(
        jsonResponse({
          latest_version_num: 4,
          updated_at: new Date(1_000_000).toISOString(),
          title: 'Agent Skill',
        })
      );
    }) as unknown as typeof fetch;

    const meta = await refreshLiveArtifactMeta(ARTIFACT_URL, {
      fetchImpl,
      now: () => 2_000_000,
    });

    expect(seen).toEqual([`${ARTIFACT_URL}/content?poll=1`]);
    expect(liveArtifactMetaUrl(ARTIFACT_URL)).toContain('poll=1');
    expect(meta).toEqual({ versionLabel: 'v4', updatedAt: 1_000_000, fetchedAt: 2_000_000 });
    expect(getLiveArtifactMeta(ARTIFACT_URL, 2_000_000)).toEqual(meta);
  });

  it('returns nothing when the artifact is unreachable, and never throws', async () => {
    const fetchImpl = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;

    await expect(refreshLiveArtifactMeta(ARTIFACT_URL, { fetchImpl })).resolves.toBeNull();
    expect(getLiveArtifactMeta(ARTIFACT_URL)).toBeNull();
  });

  it('returns nothing on a non-200 response', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        jsonResponse({ error: { code: 'not_found' } }, 404)
      )) as unknown as typeof fetch;

    await expect(refreshLiveArtifactMeta(ARTIFACT_URL, { fetchImpl })).resolves.toBeNull();
    expect(getLiveArtifactMeta(ARTIFACT_URL)).toBeNull();
  });

  it('rejects an unexpected payload shape rather than rendering it', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        jsonResponse({ latest_version_num: 'four', updated_at: 'yesterday' })
      )) as unknown as typeof fetch;

    await expect(refreshLiveArtifactMeta(ARTIFACT_URL, { fetchImpl })).resolves.toBeNull();
    expect(getLiveArtifactMeta(ARTIFACT_URL)).toBeNull();
  });

  it('rejects an unparseable timestamp', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        jsonResponse({ latest_version_num: 2, updated_at: 'not-a-date' })
      )) as unknown as typeof fetch;

    await expect(refreshLiveArtifactMeta(ARTIFACT_URL, { fetchImpl })).resolves.toBeNull();
    expect(getLiveArtifactMeta(ARTIFACT_URL)).toBeNull();
  });

  it('drops a snapshot that has gone stale instead of showing an old claim', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        jsonResponse({ latest_version_num: 1, updated_at: new Date(0).toISOString() })
      )) as unknown as typeof fetch;

    await refreshLiveArtifactMeta(ARTIFACT_URL, { fetchImpl, now: () => 0 });

    expect(getLiveArtifactMeta(ARTIFACT_URL, 44 * MINUTE)).not.toBeNull();
    expect(getLiveArtifactMeta(ARTIFACT_URL, 46 * MINUTE)).toBeNull();
  });

  it('never serves a snapshot taken for a different artifact url', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        jsonResponse({ latest_version_num: 1, updated_at: new Date(0).toISOString() })
      )) as unknown as typeof fetch;

    await refreshLiveArtifactMeta(ARTIFACT_URL, { fetchImpl, now: () => 0 });

    expect(getLiveArtifactMeta('https://other.test/a/KbLJ0zvyiGadXLHUs2E5Rb', 0)).toBeNull();
  });
});

describe('formatUpdatedLabel', () => {
  it('describes each grain the way the meta strip reads', () => {
    const now = 10 * DAY;

    expect(formatUpdatedLabel(now - 5_000, now)).toBe('updated just now');
    expect(formatUpdatedLabel(now - 7 * MINUTE, now)).toBe('updated 7 min ago');
    expect(formatUpdatedLabel(now - 6 * HOUR, now)).toBe('updated 6 h ago');
    expect(formatUpdatedLabel(now - 3 * DAY, now)).toBe('updated 3 d ago');
    expect(formatUpdatedLabel(0, 70 * DAY)).toBe('updated 2 mo ago');
  });

  it('refuses to describe a timestamp from the future', () => {
    expect(formatUpdatedLabel(10 * DAY, 0)).toBeNull();
    expect(formatUpdatedLabel(Number.NaN, 0)).toBeNull();
  });

  it('tolerates a small clock skew rather than blanking the strip', () => {
    expect(formatUpdatedLabel(1_000, 0)).toBe('updated just now');
  });
});
