import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { nanoid } from 'nanoid';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';

export const SESSION_COOKIE_NAME = 'aa_session';
export const SESSION_TOKEN_LENGTH = 32;
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_SLIDE_AFTER_MS = 15 * 24 * 60 * 60 * 1000;

export interface SessionAccount {
  id: string;
  email: string;
  passwordHash: string | null;
  suspendedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SessionRecord {
  id: string;
  accountId: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number | null;
}

export interface AuthenticatedSession {
  account: SessionAccount;
  session: SessionRecord;
  cookieValue: string;
}

export interface NewSessionMaterial {
  token: string;
  tokenHash: string;
  cookieValue: string;
  createdAt: number;
  expiresAt: number;
}

interface SessionDbRow {
  id: string;
  account_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number | null;
}

interface AccountDbRow {
  id: string;
  email: string;
  password_hash: string | null;
  suspended_at: number | null;
  created_at: number;
  updated_at: number;
}

export class SessionService {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly config: Pick<AppConfig, 'sessionSecret' | 'secureCookies' | 'baseUrl'>,
    private readonly now: () => number = Date.now
  ) {}

  async createSession(accountId: string): Promise<NewSessionMaterial> {
    const material = createSessionMaterial(this.config.sessionSecret, this.now());
    await insertSession(this.db, {
      id: material.tokenHash,
      accountId,
      createdAt: material.createdAt,
      expiresAt: material.expiresAt,
      lastSeenAt: null,
    });
    return material;
  }

  async rotateSession(
    accountId: string,
    existingCookie?: string | null
  ): Promise<NewSessionMaterial> {
    if (existingCookie) {
      const token = unsignedSessionToken(existingCookie, this.config.sessionSecret);
      if (token) {
        await deleteSession(this.db, hashToken(token));
      }
    }
    return this.createSession(accountId);
  }

  async validateCookie(
    cookieValue: string | undefined | null
  ): Promise<AuthenticatedSession | null> {
    const token = cookieValue ? unsignedSessionToken(cookieValue, this.config.sessionSecret) : null;
    if (!token) {
      return null;
    }

    const tokenHash = hashToken(token);
    const row = await getSessionWithAccount(this.db, tokenHash);
    if (!row) {
      return null;
    }

    const now = this.now();
    if (row.session.expiresAt <= now) {
      await deleteSession(this.db, tokenHash);
      return null;
    }

    if (row.session.expiresAt - now < SESSION_SLIDE_AFTER_MS) {
      row.session.expiresAt = now + SESSION_LIFETIME_MS;
      await updateSessionSeen(this.db, tokenHash, now, row.session.expiresAt);
    } else {
      await updateSessionSeen(this.db, tokenHash, now);
    }

    return {
      ...row,
      cookieValue: cookieValue ?? '',
    };
  }

  async validateContext(context: Context): Promise<AuthenticatedSession | null> {
    return this.validateCookie(getCookie(context, SESSION_COOKIE_NAME));
  }

  async deleteCookieSession(cookieValue: string | undefined | null): Promise<void> {
    const token = cookieValue ? unsignedSessionToken(cookieValue, this.config.sessionSecret) : null;
    if (token) {
      await deleteSession(this.db, hashToken(token));
    }
  }

  async deleteAllAccountSessions(accountId: string, exceptSessionHash?: string): Promise<void> {
    await deleteAccountSessions(this.db, accountId, exceptSessionHash);
  }

  async sweepExpired(): Promise<number> {
    return deleteExpiredSessions(this.db, this.now());
  }

  setSessionCookie(context: Context, cookieValue: string, expiresAt: number): void {
    setCookie(
      context,
      SESSION_COOKIE_NAME,
      cookieValue,
      sessionCookieOptions(this.config, expiresAt)
    );
  }

  clearSessionCookie(context: Context): void {
    deleteCookie(context, SESSION_COOKIE_NAME, {
      path: '/',
      secure: this.config.secureCookies,
      sameSite: 'Lax',
    });
  }
}

export function createSessionMaterial(secret: string, now = Date.now()): NewSessionMaterial {
  const token = nanoid(SESSION_TOKEN_LENGTH);
  return sessionMaterialFromToken(secret, token, now);
}

export function sessionMaterialFromToken(
  secret: string,
  token: string,
  now = Date.now()
): NewSessionMaterial {
  return {
    token,
    tokenHash: hashToken(token),
    cookieValue: signSessionToken(token, secret),
    createdAt: now,
    expiresAt: now + SESSION_LIFETIME_MS,
  };
}

export function signSessionToken(token: string, secret: string): string {
  return `${token}.${hmacToken(token, secret)}`;
}

export function unsignedSessionToken(cookieValue: string, secret: string): string | null {
  const [token, signature, extra] = cookieValue.split('.');
  if (extra !== undefined || !token || !signature || token.length !== SESSION_TOKEN_LENGTH) {
    return null;
  }

  const expected = hmacToken(token, secret);
  const actual = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actual.length !== expectedBuffer.length) {
    return null;
  }

  return timingSafeEqual(actual, expectedBuffer) ? token : null;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionCookieOptions(
  config: Pick<AppConfig, 'secureCookies'>,
  expiresAt: number
): Parameters<typeof setCookie>[3] {
  return {
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'Lax',
    expires: new Date(expiresAt),
    maxAge: Math.floor((expiresAt - Date.now()) / 1000),
  };
}

export function assertDashboardMutationOrigin(
  context: Context,
  config: Pick<AppConfig, 'baseUrl'>
): void {
  const method = context.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return;
  }

  const expectedOrigin = new URL(config.baseUrl).origin;
  const actualOrigin = originFromHeaders(context);
  if (actualOrigin !== expectedOrigin) {
    throw new CsrfOriginError();
  }
}

export class CsrfOriginError extends Error {
  readonly status = 403;
  readonly code = 'origin_mismatch';

  constructor() {
    super('Origin mismatch');
    this.name = 'CsrfOriginError';
  }
}

export function originMismatchEnvelope() {
  return {
    error: {
      code: 'origin_mismatch',
      message: 'Origin mismatch',
    },
  };
}

function originFromHeaders(context: Context): string | null {
  const origin = context.req.header('origin');
  if (origin) {
    return safeOrigin(origin);
  }

  const referer = context.req.header('referer');
  return referer ? safeOrigin(referer) : null;
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hmacToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

async function insertSession(
  db: DatabaseHandle,
  input: {
    id: string;
    accountId: string;
    createdAt: number;
    expiresAt: number;
    lastSeenAt: number | null;
  }
): Promise<void> {
  if (db.dialect === 'sqlite') {
    db.sqlite
      .prepare(
        `
          INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(input.id, input.accountId, input.createdAt, input.expiresAt, input.lastSeenAt);
    return;
  }

  await db.pool.query(
    `
      INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
    [input.id, input.accountId, input.createdAt, input.expiresAt, input.lastSeenAt]
  );
}

async function getSessionWithAccount(
  db: DatabaseHandle,
  sessionId: string
): Promise<{ session: SessionRecord; account: SessionAccount } | null> {
  const sql = `
    SELECT
      s.id AS session_id, s.account_id, s.created_at AS session_created_at,
      s.expires_at, s.last_seen_at,
      a.id AS account_id_value, a.email, a.password_hash, a.suspended_at,
      a.created_at AS account_created_at, a.updated_at AS account_updated_at
    FROM sessions s
    JOIN accounts a ON a.id = s.account_id
    WHERE s.id = ?
  `;

  const row =
    db.dialect === 'sqlite'
      ? (db.sqlite.prepare(sql).get(sessionId) as SessionAccountJoinRow | undefined)
      : (await db.pool.query<SessionAccountJoinRow>(sql.replace('?', '$1'), [sessionId])).rows[0];

  return row ? sessionJoinFromRow(row) : null;
}

async function updateSessionSeen(
  db: DatabaseHandle,
  sessionId: string,
  lastSeenAt: number,
  expiresAt?: number
): Promise<void> {
  if (db.dialect === 'sqlite') {
    if (expiresAt !== undefined) {
      db.sqlite
        .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
        .run(lastSeenAt, expiresAt, sessionId);
    } else {
      db.sqlite
        .prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
        .run(lastSeenAt, sessionId);
    }
    return;
  }

  if (expiresAt !== undefined) {
    await db.pool.query('UPDATE sessions SET last_seen_at = $1, expires_at = $2 WHERE id = $3', [
      lastSeenAt,
      expiresAt,
      sessionId,
    ]);
  } else {
    await db.pool.query('UPDATE sessions SET last_seen_at = $1 WHERE id = $2', [
      lastSeenAt,
      sessionId,
    ]);
  }
}

async function deleteSession(db: DatabaseHandle, sessionId: string): Promise<void> {
  if (db.dialect === 'sqlite') {
    db.sqlite.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return;
  }
  await db.pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

async function deleteAccountSessions(
  db: DatabaseHandle,
  accountId: string,
  exceptSessionHash?: string
): Promise<void> {
  if (db.dialect === 'sqlite') {
    if (exceptSessionHash) {
      db.sqlite
        .prepare('DELETE FROM sessions WHERE account_id = ? AND id <> ?')
        .run(accountId, exceptSessionHash);
    } else {
      db.sqlite.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
    }
    return;
  }

  if (exceptSessionHash) {
    await db.pool.query('DELETE FROM sessions WHERE account_id = $1 AND id <> $2', [
      accountId,
      exceptSessionHash,
    ]);
  } else {
    await db.pool.query('DELETE FROM sessions WHERE account_id = $1', [accountId]);
  }
}

async function deleteExpiredSessions(db: DatabaseHandle, now: number): Promise<number> {
  if (db.dialect === 'sqlite') {
    const result = db.sqlite.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    return result.changes;
  }

  const result = await db.pool.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  return result.rowCount ?? 0;
}

interface SessionAccountJoinRow extends AccountDbRow, SessionDbRow {
  session_id: string;
  session_created_at: number;
  account_id_value: string;
  account_created_at: number;
  account_updated_at: number;
}

function sessionJoinFromRow(row: SessionAccountJoinRow): {
  session: SessionRecord;
  account: SessionAccount;
} {
  return {
    session: {
      id: row.session_id,
      accountId: row.account_id,
      createdAt: row.session_created_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
    },
    account: accountFromRow({
      id: row.account_id_value,
      email: row.email,
      password_hash: row.password_hash,
      suspended_at: row.suspended_at,
      created_at: row.account_created_at,
      updated_at: row.account_updated_at,
    }),
  };
}

export function accountFromRow(row: AccountDbRow): SessionAccount {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    suspendedAt: row.suspended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
