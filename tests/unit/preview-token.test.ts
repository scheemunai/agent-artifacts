import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isSandboxAllowedPath } from '../../src/lib/host-guard.js';
import {
  OWNER_PREVIEW_TTL_MS,
  ownerPreviewFrameUrl,
  previewContentDigest,
  signOwnerPreviewToken,
  verifyOwnerPreviewToken,
} from '../../src/lib/preview-token.js';

const SECRET = 'unit-test-session-secret-with-at-least-32-bytes';
const NOW = 1_800_000_000_000;

const claims = {
  accountId: 'acc_owner',
  subject: 'artifact' as const,
  subjectId: 'art_one',
  contentHash: 'a'.repeat(64),
};

function mint(overrides: Partial<Parameters<typeof signOwnerPreviewToken>[1]> = {}): string {
  return signOwnerPreviewToken(SECRET, {
    ...claims,
    expiresAt: NOW + OWNER_PREVIEW_TTL_MS,
    ...overrides,
  });
}

describe('owner preview token', () => {
  it('round-trips every claim the frame route needs to answer', () => {
    const verified = verifyOwnerPreviewToken(SECRET, mint(), NOW);

    expect(verified).toEqual({
      ...claims,
      expiresAt: NOW + OWNER_PREVIEW_TTL_MS,
    });
  });

  it('expires — the whole point of a handoff rather than a credential', () => {
    const token = mint();

    // One millisecond before, and one after. The boundary is the assertion: a token that survived
    // its own expiry by a tick would be a token whose TTL is decorative.
    expect(verifyOwnerPreviewToken(SECRET, token, NOW + OWNER_PREVIEW_TTL_MS - 1)).not.toBeNull();
    expect(verifyOwnerPreviewToken(SECRET, token, NOW + OWNER_PREVIEW_TTL_MS)).toBeNull();
    expect(verifyOwnerPreviewToken(SECRET, token, NOW + OWNER_PREVIEW_TTL_MS + 1)).toBeNull();
  });

  it('is minted for five minutes, not for a session', () => {
    const url = new URL(ownerPreviewFrameUrl(configFor(undefined), claims, NOW));
    const token = url.pathname.split('/')[2] as string;

    expect(verifyOwnerPreviewToken(SECRET, token, NOW)?.expiresAt).toBe(NOW + 5 * 60 * 1000);
  });

  it('refuses a payload edited after signing', () => {
    // The attack this closes is the one the account scoping depends on: take your own valid token
    // and rewrite the account id in it. The MAC covers the encoded payload, so the edit invalidates
    // the signature rather than producing a token for somebody else's artifact.
    const token = mint();
    const [encoded, mac] = token.split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      a: string;
    };
    payload.a = 'acc_someone_else';
    const forged = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${mac}`;

    expect(verifyOwnerPreviewToken(SECRET, forged, NOW)).toBeNull();
  });

  it('refuses a token signed with a different secret', () => {
    const foreign = signOwnerPreviewToken('a-different-secret-of-at-least-32-bytes-long', {
      ...claims,
      expiresAt: NOW + OWNER_PREVIEW_TTL_MS,
    });

    expect(verifyOwnerPreviewToken(SECRET, foreign, NOW)).toBeNull();
  });

  it('refuses a flipped MAC, a truncated token, and nothing at all', () => {
    const token = mint();
    const [encoded, mac] = token.split('.') as [string, string];
    const flipped = `${encoded}.${mac.slice(0, -1)}${mac.endsWith('0') ? '1' : '0'}`;

    expect(verifyOwnerPreviewToken(SECRET, flipped, NOW)).toBeNull();
    expect(verifyOwnerPreviewToken(SECRET, encoded, NOW)).toBeNull();
    expect(verifyOwnerPreviewToken(SECRET, `${token}.extra`, NOW)).toBeNull();
    expect(verifyOwnerPreviewToken(SECRET, '', NOW)).toBeNull();
    expect(verifyOwnerPreviewToken(SECRET, null, NOW)).toBeNull();
    expect(verifyOwnerPreviewToken(SECRET, undefined, NOW)).toBeNull();
  });

  it('is single-purpose: a validly signed payload for anything else is not a preview token', () => {
    // Same secret, same construction, different `p`. Without the purpose in the signed payload,
    // any other HMAC this app mints over a base64url blob would be spendable here.
    const encoded = Buffer.from(
      JSON.stringify({
        p: 'share-access',
        v: 1,
        a: claims.accountId,
        s: 'artifact',
        i: claims.subjectId,
        h: claims.contentHash,
        e: NOW + OWNER_PREVIEW_TTL_MS,
      }),
      'utf8'
    ).toString('base64url');
    const wrongPurpose = `${encoded}.${createHmac('sha256', SECRET).update(encoded).digest('hex')}`;

    expect(verifyOwnerPreviewToken(SECRET, wrongPurpose, NOW)).toBeNull();
  });

  it('accepts only the two subjects the frame route can read', () => {
    expect(verifyOwnerPreviewToken(SECRET, mint({ subject: 'template' }), NOW)?.subject).toBe(
      'template'
    );
    expect(
      verifyOwnerPreviewToken(SECRET, mint({ subject: 'account' as unknown as 'artifact' }), NOW)
    ).toBeNull();
  });

  it('points at the sandbox host when there is one and at the app host when there is not', () => {
    // The single conditional in the whole feature. Cloud has two hosts and only the sandbox host is
    // in the dashboard's `frame-src`; self-hosted has one, and its `frame-src 'self'` is that host.
    const cloud = new URL(
      ownerPreviewFrameUrl(configFor('https://usercontent.example.test'), claims, NOW)
    );
    const self = new URL(ownerPreviewFrameUrl(configFor(undefined), claims, NOW));

    expect(cloud.origin).toBe('https://usercontent.example.test');
    expect(self.origin).toBe('https://app.example.test');
    expect(cloud.pathname).toMatch(/^\/preview\/[A-Za-z0-9_-]+\.[a-f0-9]{64}\/frame$/);
    expect(self.pathname).toMatch(/^\/preview\/[A-Za-z0-9_-]+\.[a-f0-9]{64}\/frame$/);
  });

  it('mints a URL the sandbox host guard already allows', () => {
    // The guard and the URL builder are in different modules and could drift apart silently: a
    // token shape the guard does not recognise would 404 on cloud and pass every same-origin test.
    const path = new URL(
      ownerPreviewFrameUrl(configFor('https://usercontent.example.test'), claims, NOW)
    ).pathname;

    expect(isSandboxAllowedPath(path)).toBe(true);
    expect(isSandboxAllowedPath('/preview/not-a-token/frame')).toBe(false);
    expect(isSandboxAllowedPath(`${path}/../../dashboard`)).toBe(false);
  });

  it('changes the URL whenever the content does', () => {
    // Why the content hash is in the payload at all: two revisions can never share a frame URL, so
    // nothing between the browser and the app can serve a stale preview.
    const first = ownerPreviewFrameUrl(configFor(undefined), claims, NOW);
    const second = ownerPreviewFrameUrl(
      configFor(undefined),
      { ...claims, contentHash: 'b'.repeat(64) },
      NOW
    );

    expect(first).not.toBe(second);
  });

  it('digests template content, which stores no hash of its own', () => {
    expect(previewContentDigest('<h1>One</h1>')).toMatch(/^[a-f0-9]{64}$/);
    expect(previewContentDigest('<h1>One</h1>')).toBe(previewContentDigest('<h1>One</h1>'));
    expect(previewContentDigest('<h1>One</h1>')).not.toBe(previewContentDigest('<h1>Two</h1>'));
  });
});

function configFor(sandboxOrigin: string | undefined) {
  return {
    sessionSecret: SECRET,
    baseUrl: 'https://app.example.test',
    ...(sandboxOrigin ? { sandboxOrigin } : {}),
  };
}
