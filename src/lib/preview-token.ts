import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import { hmacHex, timingSafeEqualHex } from './signed-token.js';

/**
 * The owner preview token: how the *sandbox* origin is allowed to render a signed-in owner's
 * private HTML without ever seeing the dashboard session.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 *
 * The dashboard's own CSP is `frame-src <SANDBOX_ORIGIN>` on cloud — the dashboard origin may frame
 * the isolated user-content host and nothing else, which is the entire point of having a second
 * host. The owner's "Rendered preview" used to be a *same-origin* iframe at
 * `/dashboard/artifacts/:id/frame`, so on cloud the browser refused to load it and the card
 * rendered blank. It only ever worked self-hosted, where `SANDBOX_ORIGIN` is unset and
 * `frame-src` falls back to `'self'`.
 *
 * The fix is not to re-admit `'self'` to the dashboard's `frame-src`: that would let an artifact's
 * scripts run on the origin that holds the owner's session cookie, which is precisely the risk the
 * sandbox host exists to remove. Instead the owner preview moves to the sandbox host, exactly like
 * a public artifact frame — and because that host is cross-origin, it never receives the session
 * cookie and cannot authenticate the owner. This token carries that authorisation instead.
 *
 * ── WHAT THE TOKEN IS ──────────────────────────────────────────────────────────────────────────
 *
 * `base64url(json).hmac-sha256-hex`, signed with the app's existing `SESSION_SECRET` (the same
 * secret and the same primitives as the share-access token in `services/viewer.ts`). Single
 * purpose, and the purpose is *in* the signed payload: a token minted here can only ever be spent
 * on `/preview/:token/frame`, and a share-access token can never be spent here.
 *
 * It is deliberately narrow:
 *   · scoped to one account and one artifact/template — it cannot read a different owner's work;
 *   · minted only by a page render that already passed the session gate;
 *   · valid for five minutes, which is the gap between rendering a page and its iframe loading,
 *     not a session;
 *   · read-only, and only for the preview frame.
 *
 * `contentHash` is signed but not required to match at read time — see `routes/preview.ts` for why
 * that is the honest choice rather than an oversight.
 */

const OWNER_PREVIEW_PURPOSE = 'owner-preview';
const OWNER_PREVIEW_VERSION = 1;

/** Five minutes: long enough for a page to render and its iframe to load, short enough to be a
 * handoff rather than a credential. */
export const OWNER_PREVIEW_TTL_MS = 5 * 60 * 1000;

/** Path shape, shared by the route, the sandbox host guard and the tests, so all three agree. */
export const OWNER_PREVIEW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,3000}\.[a-f0-9]{64}$/;

export type OwnerPreviewSubject = 'artifact' | 'template';

export interface OwnerPreviewClaims {
  accountId: string;
  subject: OwnerPreviewSubject;
  subjectId: string;
  /** The bytes the preview was minted for. Bound so the token cannot be replayed as a claim about
   * some *other* revision, and so the frame URL changes whenever the content does. */
  contentHash: string;
  expiresAt: number;
}

interface OwnerPreviewPayload {
  p: string;
  v: number;
  a: string;
  s: string;
  i: string;
  h: string;
  e: number;
}

export function signOwnerPreviewToken(secret: string, claims: OwnerPreviewClaims): string {
  const payload: OwnerPreviewPayload = {
    p: OWNER_PREVIEW_PURPOSE,
    v: OWNER_PREVIEW_VERSION,
    a: claims.accountId,
    s: claims.subject,
    i: claims.subjectId,
    h: claims.contentHash,
    e: Math.floor(claims.expiresAt),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${hmacHex(secret, encoded)}`;
}

/**
 * Verify before parse. The MAC is checked against the *encoded* string, so no attacker-controlled
 * JSON is deserialised until the signature has already proved the app minted it.
 */
export function verifyOwnerPreviewToken(
  secret: string,
  token: string | null | undefined,
  now: number
): OwnerPreviewClaims | null {
  if (!token || !OWNER_PREVIEW_TOKEN_PATTERN.test(token)) {
    return null;
  }

  const [encoded, mac, extra] = token.split('.');
  if (!encoded || !mac || extra !== undefined) {
    return null;
  }

  if (!timingSafeEqualHex(mac, hmacHex(secret, encoded))) {
    return null;
  }

  const payload = decodePayload(encoded);
  if (!payload) {
    return null;
  }

  if (payload.p !== OWNER_PREVIEW_PURPOSE || payload.v !== OWNER_PREVIEW_VERSION) {
    return null;
  }

  if (payload.s !== 'artifact' && payload.s !== 'template') {
    return null;
  }

  if (!Number.isSafeInteger(payload.e) || payload.e <= now) {
    return null;
  }

  if (!payload.a || !payload.i) {
    return null;
  }

  return {
    accountId: payload.a,
    subject: payload.s,
    subjectId: payload.i,
    contentHash: payload.h,
    expiresAt: payload.e,
  };
}

/**
 * The URL the dashboard puts in the iframe.
 *
 * The origin is the sandbox host when there is one and the app's own origin when there is not —
 * the same `sandboxOrigin ?? baseUrl` choice `ViewerService.frameUrl()` makes for public artifact
 * frames, and made here for the same reason: self-hosted has one host, so its preview is
 * same-origin and its `frame-src 'self'` permits it, while cloud has two and only the sandbox host
 * is permitted. One code path serves both; nothing is conditional except the origin.
 */
export function ownerPreviewFrameUrl(
  config: Pick<AppConfig, 'sessionSecret' | 'sandboxOrigin' | 'baseUrl'>,
  claims: Omit<OwnerPreviewClaims, 'expiresAt'>,
  now: number = Date.now()
): string {
  const token = signOwnerPreviewToken(config.sessionSecret, {
    ...claims,
    expiresAt: now + OWNER_PREVIEW_TTL_MS,
  });
  return new URL(`/preview/${token}/frame`, config.sandboxOrigin ?? config.baseUrl).toString();
}

/**
 * A content hash for subjects that do not store one. Artifacts carry `content_hash` already and
 * pass it straight through; templates do not, and hashing the bytes here beats adding a column for
 * a value only this token binds.
 */
export function previewContentDigest(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function decodePayload(encoded: string): OwnerPreviewPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.p !== 'string' ||
      typeof candidate.v !== 'number' ||
      typeof candidate.a !== 'string' ||
      typeof candidate.s !== 'string' ||
      typeof candidate.i !== 'string' ||
      typeof candidate.h !== 'string' ||
      typeof candidate.e !== 'number'
    ) {
      return null;
    }
    return candidate as unknown as OwnerPreviewPayload;
  } catch {
    return null;
  }
}
