import { timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argon2id, hash as argonHash, verify as argonVerify } from 'argon2';
import { nanoid } from 'nanoid';
import type { PoolClient } from 'pg';
import type { AppConfig } from '../config.js';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from '../db/client.js';
import type { Account } from '../extension/cloud-module.js';
import type { Logger } from '../logger.js';
import { hashSecret } from './bots.js';
import {
  createSessionMaterial,
  hashToken,
  type NewSessionMaterial,
  type SessionAccount,
} from './sessions.js';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const SETUP_TOKEN_LENGTH = 24;
export const ARGON2ID_PASSWORD_PARAMS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface PasswordLoginResult {
  account: SessionAccount;
  session: NewSessionMaterial;
}

export interface MagicLinkIssueResult {
  email: string;
  token: string | null;
  url: string | null;
}

export interface MagicLinkConsumeResult {
  ok: boolean;
  account?: SessionAccount;
  session?: NewSessionMaterial;
  email?: string | undefined;
}

export interface EmailChangeIssueResult {
  email: string;
  token: string;
  url: string;
}

export interface EmailChangeConsumeResult {
  ok: boolean;
  account?: SessionAccount;
  session?: NewSessionMaterial;
  email?: string | undefined;
}

export interface SetupState {
  accountCount: number;
  hasSetupToken: boolean;
  tokenPath: string;
}

export interface SetupCompletionInput {
  setupToken: string;
  email: string;
  password: string;
  botName: string;
  botByline?: string | null;
}

export interface SetupCompletionResult {
  account: SessionAccount;
  session: NewSessionMaterial;
  bot: BotRecord;
  apiKey: string;
}

export interface BotRecord {
  id: string;
  accountId: string;
  name: string;
  byline: string | null;
  apiKeyLast4: string;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface VerifiedBotKey {
  account: Account;
  bot: BotRecord;
}

interface AccountDbRow {
  id: string;
  email: string;
  password_hash: string | null;
  suspended_at: number | null;
  created_at: number;
  updated_at: number;
}

interface MagicLinkTokenRow {
  id: string;
  token_hash: string;
  email: string;
  account_id: string | null;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

interface BotDbRow {
  id: string;
  account_id: string;
  name: string;
  byline: string | null;
  api_key_hash: string;
  api_key_last4: string;
  last_used_at: number | null;
  revoked_at: number | null;
  created_at: number;
  updated_at: number;
}

interface VerifiedBotRow extends BotDbRow {
  account_email: string;
  account_suspended_at: number | null;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class AuthService {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly config: Pick<
      AppConfig,
      'baseUrl' | 'dataDir' | 'sessionSecret' | 'deployment'
    >,
    private readonly logger?: Logger,
    private readonly now: () => number = Date.now
  ) {}

  async countAccounts(): Promise<number> {
    if (this.db.dialect === 'sqlite') {
      const row = this.db.sqlite.prepare('SELECT count(*) AS count FROM accounts').get() as {
        count: number;
      };
      return row.count;
    }

    const result = await this.db.pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM accounts'
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async getSetupState(): Promise<SetupState> {
    return {
      accountCount: await this.countAccounts(),
      hasSetupToken: existsSync(this.setupTokenPath),
      tokenPath: this.setupTokenPath,
    };
  }

  async ensureSetupToken(): Promise<string | null> {
    if (this.config.deployment !== 'self-hosted' || (await this.countAccounts()) > 0) {
      return null;
    }

    mkdirSync(dirname(this.setupTokenPath), { recursive: true, mode: 0o700 });
    if (existsSync(this.setupTokenPath)) {
      chmodSync(this.setupTokenPath, 0o600);
      return readFileSync(this.setupTokenPath, 'utf8').trim();
    }

    const token = nanoid(SETUP_TOKEN_LENGTH);
    writeFileSync(this.setupTokenPath, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    chmodSync(this.setupTokenPath, 0o600);
    this.logger?.info(
      { setup_token_path: this.setupTokenPath },
      `Setup token: ${token} — required at /setup`
    );
    return token;
  }

  async validateSetupToken(token: string): Promise<boolean> {
    if ((await this.countAccounts()) > 0 || !existsSync(this.setupTokenPath)) {
      return false;
    }

    return timingSafeStringEqual(readFileSync(this.setupTokenPath, 'utf8').trim(), token.trim());
  }

  async completeSetup(input: SetupCompletionInput): Promise<SetupCompletionResult> {
    if (!(await this.validateSetupToken(input.setupToken))) {
      throw new AuthError(403, 'setup_token_required', 'Setup token is required');
    }

    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const now = this.now();
    const accountId = `acc_${nanoid(21)}`;
    const apiKey = createBotApiKey();
    const bot: BotRecord = {
      id: `bot_${nanoid(21)}`,
      accountId,
      name: input.botName.trim(),
      byline: normalizeOptional(input.botByline),
      apiKeyLast4: apiKey.slice(-4),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const session = createSessionMaterial(this.config.sessionSecret, now);

    if (this.db.dialect === 'sqlite') {
      this.completeSetupSqlite({ accountId, email, passwordHash, bot, apiKey, session, now });
    } else {
      await this.completeSetupPostgres({
        accountId,
        email,
        passwordHash,
        bot,
        apiKey,
        session,
        now,
      });
    }

    rmSync(this.setupTokenPath, { force: true });

    return {
      account: {
        id: accountId,
        email,
        passwordHash,
        suspendedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      session,
      bot,
      apiKey,
    };
  }

  async createPasswordAccount(emailInput: string, password: string): Promise<SessionAccount> {
    const email = normalizeEmail(emailInput);
    const passwordHash = await hashPassword(password);
    const now = this.now();
    const account: SessionAccount = {
      id: `acc_${nanoid(21)}`,
      email,
      passwordHash,
      suspendedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    if (this.db.dialect === 'sqlite') {
      this.db.sqlite
        .prepare(
          `
            INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, ?)
          `
        )
        .run(account.id, account.email, account.passwordHash, account.createdAt, account.updatedAt);
    } else {
      await this.db.pool.query(
        `
          INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
          VALUES ($1, $2, $3, NULL, $4, $5)
        `,
        [account.id, account.email, account.passwordHash, account.createdAt, account.updatedAt]
      );
    }

    return account;
  }

  async loginWithPassword(
    emailInput: string,
    password: string
  ): Promise<PasswordLoginResult | null> {
    const account = await this.findAccountByEmail(emailInput);
    if (!account?.passwordHash || account.suspendedAt) {
      await verifyPasswordIfHashExists(null, password);
      return null;
    }

    const valid = await verifyPasswordIfHashExists(account.passwordHash, password);
    if (!valid) {
      return null;
    }

    const session = await this.createSession(account.id);
    return { account, session };
  }

  async changePassword(
    accountId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<SessionAccount> {
    const account = await this.findAccountById(accountId);
    if (
      !account?.passwordHash ||
      !(await verifyPasswordIfHashExists(account.passwordHash, currentPassword))
    ) {
      throw new AuthError(400, 'invalid_password', 'Current password is incorrect');
    }

    const passwordHash = await hashPassword(newPassword);
    const now = this.now();
    if (this.db.dialect === 'sqlite') {
      this.db.sqlite
        .prepare('UPDATE accounts SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(passwordHash, now, accountId);
    } else {
      await this.db.pool.query(
        'UPDATE accounts SET password_hash = $1, updated_at = $2 WHERE id = $3',
        [passwordHash, now, accountId]
      );
    }

    return { ...account, passwordHash, updatedAt: now };
  }

  async updateAccountEmail(accountId: string, email: string): Promise<void> {
    const now = this.now();
    if (this.db.dialect === 'sqlite') {
      this.db.sqlite
        .prepare('UPDATE accounts SET email = ?, updated_at = ? WHERE id = ?')
        .run(email, now, accountId);
      return;
    }

    await this.db.pool.query('UPDATE accounts SET email = $1, updated_at = $2 WHERE id = $3', [
      email,
      now,
      accountId,
    ]);
  }

  async requestMagicLink(emailInput: string): Promise<MagicLinkIssueResult> {
    const email = normalizeEmail(emailInput);
    const existing = await this.findAccountByEmail(email);

    if (this.config.deployment === 'self-hosted' && !existing) {
      return { email, token: null, url: null };
    }

    const token = nanoid(32);
    const tokenHash = hashToken(token);
    const now = this.now();
    const expiresAt = now + MAGIC_LINK_TTL_MS;

    if (this.db.dialect === 'sqlite') {
      this.db.sqlite
        .prepare(
          `
            INSERT INTO magic_link_tokens (
              id, token_hash, email, account_id, created_at, expires_at, consumed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL)
          `
        )
        .run(`mlt_${nanoid(21)}`, tokenHash, email, existing?.id ?? null, now, expiresAt);
    } else {
      await this.db.pool.query(
        `
          INSERT INTO magic_link_tokens (
            id, token_hash, email, account_id, created_at, expires_at, consumed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NULL)
        `,
        [`mlt_${nanoid(21)}`, tokenHash, email, existing?.id ?? null, now, expiresAt]
      );
    }

    return { email, token, url: `${this.config.baseUrl}/auth/verify?token=${token}` };
  }

  async consumeMagicLink(token: string): Promise<MagicLinkConsumeResult> {
    const tokenHash = hashToken(token);
    return this.db.dialect === 'sqlite'
      ? this.consumeMagicLinkSqlite(tokenHash)
      : this.consumeMagicLinkPostgres(tokenHash);
  }

  async requestEmailChange(accountId: string, emailInput: string): Promise<EmailChangeIssueResult> {
    const account = await this.findAccountById(accountId);
    if (!account || account.suspendedAt) {
      throw new AuthError(403, 'unauthorized', 'Log in to continue');
    }
    const email = normalizeEmail(emailInput);
    if (!email?.includes('@')) {
      throw new AuthError(400, 'validation_failed', 'Enter a valid email address');
    }
    const existing = await this.findAccountByEmail(email);
    if (existing && existing.id !== accountId) {
      throw new AuthError(409, 'email_conflict', 'Email is already in use');
    }

    const token = nanoid(32);
    const now = this.now();
    const expiresAt = now + MAGIC_LINK_TTL_MS;
    const tokenHash = hashToken(token);
    if (this.db.dialect === 'sqlite') {
      this.db.sqlite
        .prepare(
          `
            INSERT INTO magic_link_tokens (
              id, token_hash, email, account_id, created_at, expires_at, consumed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL)
          `
        )
        .run(`mlt_${nanoid(21)}`, tokenHash, email, accountId, now, expiresAt);
    } else {
      await this.db.pool.query(
        `
          INSERT INTO magic_link_tokens (
            id, token_hash, email, account_id, created_at, expires_at, consumed_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NULL)
        `,
        [`mlt_${nanoid(21)}`, tokenHash, email, accountId, now, expiresAt]
      );
    }

    return { email, token, url: `${this.config.baseUrl}/auth/change-email?token=${token}` };
  }

  async consumeEmailChangeToken(token: string): Promise<EmailChangeConsumeResult> {
    const tokenHash = hashToken(token);
    return this.db.dialect === 'sqlite'
      ? this.consumeEmailChangeTokenSqlite(tokenHash)
      : this.consumeEmailChangeTokenPostgres(tokenHash);
  }

  async findAccountByEmail(emailInput: string): Promise<SessionAccount | null> {
    const email = normalizeEmail(emailInput);
    if (this.db.dialect === 'sqlite') {
      const row = this.db.sqlite.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as
        | AccountDbRow
        | undefined;
      return row ? accountFromRow(row) : null;
    }

    const result = await this.db.pool.query<AccountDbRow>(
      'SELECT * FROM accounts WHERE email = $1',
      [email]
    );
    return result.rows[0] ? accountFromRow(result.rows[0]) : null;
  }

  async findAccountById(accountId: string): Promise<SessionAccount | null> {
    if (this.db.dialect === 'sqlite') {
      const row = this.db.sqlite.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
        | AccountDbRow
        | undefined;
      return row ? accountFromRow(row) : null;
    }

    const result = await this.db.pool.query<AccountDbRow>('SELECT * FROM accounts WHERE id = $1', [
      accountId,
    ]);
    return result.rows[0] ? accountFromRow(result.rows[0]) : null;
  }

  async createSession(accountId: string): Promise<NewSessionMaterial> {
    const session = createSessionMaterial(this.config.sessionSecret, this.now());
    await insertSession(this.db, accountId, session);
    return session;
  }

  async deleteAccountHard(accountId: string): Promise<void> {
    if (this.db.dialect === 'sqlite') {
      this.db.sqlite.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
      return;
    }

    await this.db.pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  }

  async listBots(accountId: string): Promise<BotRecord[]> {
    if (this.db.dialect === 'sqlite') {
      const rows = this.db.sqlite
        .prepare('SELECT * FROM bots WHERE account_id = ? ORDER BY created_at DESC, id DESC')
        .all(accountId) as BotDbRow[];
      return rows.map(botFromRow);
    }

    const result = await this.db.pool.query<BotDbRow>(
      'SELECT * FROM bots WHERE account_id = $1 ORDER BY created_at DESC, id DESC',
      [accountId]
    );
    return result.rows.map(botFromRow);
  }

  async getLatestBot(accountId: string): Promise<BotRecord | null> {
    const bots = await this.listBots(accountId);
    return bots[0] ?? null;
  }

  async createBot(
    account: Account,
    name: string,
    byline?: string | null
  ): Promise<{ bot: BotRecord; apiKey: string }> {
    const now = this.now();
    const apiKey = createBotApiKey();
    const bot: BotRecord = {
      id: `bot_${nanoid(21)}`,
      accountId: account.id,
      name: name.trim(),
      byline: normalizeOptional(byline),
      apiKeyLast4: apiKey.slice(-4),
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await insertBot(this.db, bot, apiKey);
    return { bot, apiKey };
  }

  async regenerateBotKey(
    accountId: string,
    botId: string,
    typedName: string
  ): Promise<{ bot: BotRecord; apiKey: string }> {
    const bot = await this.getBot(accountId, botId);
    if (!bot || typedName !== bot.name) {
      throw new AuthError(400, 'confirmation_mismatch', 'Type the bot name to confirm');
    }

    const apiKey = createBotApiKey();
    const now = this.now();
    if (this.db.dialect === 'sqlite') {
      this.db.sqlite
        .prepare(
          `
            UPDATE bots
            SET api_key_hash = ?, api_key_last4 = ?, revoked_at = NULL, updated_at = ?
            WHERE id = ? AND account_id = ?
          `
        )
        .run(hashSecret(apiKey), apiKey.slice(-4), now, botId, accountId);
    } else {
      await this.db.pool.query(
        `
          UPDATE bots
          SET api_key_hash = $1, api_key_last4 = $2, revoked_at = NULL, updated_at = $3
          WHERE id = $4 AND account_id = $5
        `,
        [hashSecret(apiKey), apiKey.slice(-4), now, botId, accountId]
      );
    }

    return {
      bot: { ...bot, apiKeyLast4: apiKey.slice(-4), revokedAt: null, updatedAt: now },
      apiKey,
    };
  }

  async revokeBotKey(accountId: string, botId: string, typedName: string): Promise<BotRecord> {
    const bot = await this.getBot(accountId, botId);
    if (!bot || typedName !== bot.name) {
      throw new AuthError(400, 'confirmation_mismatch', 'Type the bot name to confirm');
    }

    const now = this.now();
    if (this.db.dialect === 'sqlite') {
      this.db.sqlite
        .prepare('UPDATE bots SET revoked_at = ?, updated_at = ? WHERE id = ? AND account_id = ?')
        .run(now, now, botId, accountId);
    } else {
      await this.db.pool.query(
        'UPDATE bots SET revoked_at = $1, updated_at = $1 WHERE id = $2 AND account_id = $3',
        [now, botId, accountId]
      );
    }

    return { ...bot, revokedAt: now, updatedAt: now };
  }

  async getBot(accountId: string, botId: string): Promise<BotRecord | null> {
    if (this.db.dialect === 'sqlite') {
      const row = this.db.sqlite
        .prepare('SELECT * FROM bots WHERE id = ? AND account_id = ?')
        .get(botId, accountId) as BotDbRow | undefined;
      return row ? botFromRow(row) : null;
    }

    const result = await this.db.pool.query<BotDbRow>(
      'SELECT * FROM bots WHERE id = $1 AND account_id = $2',
      [botId, accountId]
    );
    return result.rows[0] ? botFromRow(result.rows[0]) : null;
  }

  async verifyBotKey(apiKey: string): Promise<VerifiedBotKey | null> {
    if (!apiKey.startsWith('aa_bot_')) {
      return null;
    }

    const apiKeyHash = hashSecret(apiKey);
    const row = await selectVerifiedBot(this.db, apiKeyHash);
    if (!row || row.revoked_at !== null || row.account_suspended_at !== null) {
      return null;
    }

    return {
      account: {
        id: row.account_id,
        email: row.account_email,
        suspendedAt: row.account_suspended_at,
      },
      bot: botFromRow(row),
    };
  }

  async sweepMagicLinks(): Promise<number> {
    const now = this.now();
    if (this.db.dialect === 'sqlite') {
      const result = this.db.sqlite
        .prepare('DELETE FROM magic_link_tokens WHERE expires_at <= ? OR consumed_at IS NOT NULL')
        .run(now);
      return result.changes;
    }

    const result = await this.db.pool.query(
      'DELETE FROM magic_link_tokens WHERE expires_at <= $1 OR consumed_at IS NOT NULL',
      [now]
    );
    return result.rowCount ?? 0;
  }

  get setupTokenPath(): string {
    return resolve(this.config.dataDir, '.setup-token');
  }

  private completeSetupSqlite(input: {
    accountId: string;
    email: string;
    passwordHash: string;
    bot: BotRecord;
    apiKey: string;
    session: NewSessionMaterial;
    now: number;
  }): void {
    const handle = this.db as SqliteDatabaseHandle;
    const transaction = handle.sqlite.transaction(() => {
      if (this.countAccountsSync(handle) > 0) {
        throw new AuthError(409, 'setup_already_complete', 'Setup is already complete');
      }

      handle.sqlite
        .prepare(
          `
            INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
            VALUES (?, ?, ?, NULL, ?, ?)
          `
        )
        .run(input.accountId, input.email, input.passwordHash, input.now, input.now);
      insertSqliteBot(handle, input.bot, input.apiKey);
      insertSqliteSession(handle, input.accountId, input.session);
    });
    transaction.immediate();
  }

  private async completeSetupPostgres(input: {
    accountId: string;
    email: string;
    passwordHash: string;
    bot: BotRecord;
    apiKey: string;
    session: NewSessionMaterial;
    now: number;
  }): Promise<void> {
    const handle = this.db as PostgresDatabaseHandle;
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      const count = await client.query<{ count: string }>('SELECT count(*) AS count FROM accounts');
      if (Number(count.rows[0]?.count ?? 0) > 0) {
        throw new AuthError(409, 'setup_already_complete', 'Setup is already complete');
      }
      await client.query(
        `
          INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
          VALUES ($1, $2, $3, NULL, $4, $4)
        `,
        [input.accountId, input.email, input.passwordHash, input.now]
      );
      await insertPostgresBot(client, input.bot, input.apiKey);
      await client.query(
        `
          INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
          VALUES ($1, $2, $3, $4, NULL)
        `,
        [input.session.tokenHash, input.accountId, input.session.createdAt, input.session.expiresAt]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private consumeMagicLinkSqlite(tokenHash: string): MagicLinkConsumeResult {
    const handle = this.db as SqliteDatabaseHandle;
    const transaction = handle.sqlite.transaction(() => {
      const now = this.now();
      const token = handle.sqlite
        .prepare('SELECT * FROM magic_link_tokens WHERE token_hash = ?')
        .get(tokenHash) as MagicLinkTokenRow | undefined;

      if (!token || token.consumed_at !== null || token.expires_at <= now) {
        return { ok: false, email: token?.email } satisfies MagicLinkConsumeResult;
      }

      let account = token.account_id ? this.findAccountByIdSync(handle, token.account_id) : null;
      account ??= this.findAccountByEmailSync(handle, token.email);
      if (!account) {
        account = {
          id: `acc_${nanoid(21)}`,
          email: token.email,
          passwordHash: null,
          suspendedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        handle.sqlite
          .prepare(
            `
              INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
              VALUES (?, ?, NULL, NULL, ?, ?)
            `
          )
          .run(account.id, account.email, now, now);
      }

      handle.sqlite
        .prepare(
          'UPDATE magic_link_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL'
        )
        .run(now, token.id);
      const session = createSessionMaterial(this.config.sessionSecret, now);
      insertSqliteSession(handle, account.id, session);
      return { ok: true, account, session } satisfies MagicLinkConsumeResult;
    });

    return transaction.immediate();
  }

  private async consumeMagicLinkPostgres(tokenHash: string): Promise<MagicLinkConsumeResult> {
    const handle = this.db as PostgresDatabaseHandle;
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      const now = this.now();
      const token = (
        await client.query<MagicLinkTokenRow>(
          'SELECT * FROM magic_link_tokens WHERE token_hash = $1 FOR UPDATE',
          [tokenHash]
        )
      ).rows[0];
      if (!token || token.consumed_at !== null || token.expires_at <= now) {
        await client.query('ROLLBACK');
        return { ok: false, email: token?.email };
      }

      let account = token.account_id
        ? await selectAccountByIdPostgres(handle, token.account_id)
        : null;
      account ??= await selectAccountByEmailPostgres(handle, token.email);
      if (!account) {
        account = {
          id: `acc_${nanoid(21)}`,
          email: token.email,
          passwordHash: null,
          suspendedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        await client.query(
          `
            INSERT INTO accounts (id, email, password_hash, suspended_at, created_at, updated_at)
            VALUES ($1, $2, NULL, NULL, $3, $3)
          `,
          [account.id, account.email, now]
        );
      }

      await client.query(
        'UPDATE magic_link_tokens SET consumed_at = $1 WHERE id = $2 AND consumed_at IS NULL',
        [now, token.id]
      );
      const session = createSessionMaterial(this.config.sessionSecret, now);
      await client.query(
        `
          INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
          VALUES ($1, $2, $3, $4, NULL)
        `,
        [session.tokenHash, account.id, session.createdAt, session.expiresAt]
      );
      await client.query('COMMIT');
      return { ok: true, account, session };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private consumeEmailChangeTokenSqlite(tokenHash: string): EmailChangeConsumeResult {
    const handle = this.db as SqliteDatabaseHandle;
    const transaction = handle.sqlite.transaction(() => {
      const now = this.now();
      const token = handle.sqlite
        .prepare('SELECT * FROM magic_link_tokens WHERE token_hash = ?')
        .get(tokenHash) as MagicLinkTokenRow | undefined;

      if (!token || token.consumed_at !== null || token.expires_at <= now || !token.account_id) {
        return { ok: false, email: token?.email } satisfies EmailChangeConsumeResult;
      }

      const account = this.findAccountByIdSync(handle, token.account_id);
      if (!account || account.suspendedAt) {
        return { ok: false, email: token.email } satisfies EmailChangeConsumeResult;
      }

      const existing = this.findAccountByEmailSync(handle, token.email);
      if (existing && existing.id !== account.id) {
        return { ok: false, email: token.email } satisfies EmailChangeConsumeResult;
      }

      const updatedAccount = { ...account, email: token.email, updatedAt: now };
      handle.sqlite
        .prepare('UPDATE accounts SET email = ?, updated_at = ? WHERE id = ?')
        .run(updatedAccount.email, now, updatedAccount.id);
      handle.sqlite
        .prepare(
          'UPDATE magic_link_tokens SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL'
        )
        .run(now, token.id);
      const session = createSessionMaterial(this.config.sessionSecret, now);
      insertSqliteSession(handle, updatedAccount.id, session);
      return { ok: true, account: updatedAccount, session } satisfies EmailChangeConsumeResult;
    });

    return transaction.immediate();
  }

  private async consumeEmailChangeTokenPostgres(
    tokenHash: string
  ): Promise<EmailChangeConsumeResult> {
    const handle = this.db as PostgresDatabaseHandle;
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      const now = this.now();
      const token = (
        await client.query<MagicLinkTokenRow>(
          'SELECT * FROM magic_link_tokens WHERE token_hash = $1 FOR UPDATE',
          [tokenHash]
        )
      ).rows[0];
      if (!token || token.consumed_at !== null || token.expires_at <= now || !token.account_id) {
        await client.query('ROLLBACK');
        return { ok: false, email: token?.email };
      }

      const accountRow = (
        await client.query<AccountDbRow>('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [
          token.account_id,
        ])
      ).rows[0];
      if (!accountRow || accountRow.suspended_at !== null) {
        await client.query('ROLLBACK');
        return { ok: false, email: token.email };
      }

      const existingRow = (
        await client.query<AccountDbRow>('SELECT * FROM accounts WHERE email = $1', [token.email])
      ).rows[0];
      if (existingRow && existingRow.id !== accountRow.id) {
        await client.query('ROLLBACK');
        return { ok: false, email: token.email };
      }

      await client.query('UPDATE accounts SET email = $1, updated_at = $2 WHERE id = $3', [
        token.email,
        now,
        accountRow.id,
      ]);
      await client.query(
        'UPDATE magic_link_tokens SET consumed_at = $1 WHERE id = $2 AND consumed_at IS NULL',
        [now, token.id]
      );
      const session = createSessionMaterial(this.config.sessionSecret, now);
      await client.query(
        `
          INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
          VALUES ($1, $2, $3, $4, NULL)
        `,
        [session.tokenHash, accountRow.id, session.createdAt, session.expiresAt]
      );
      await client.query('COMMIT');
      return {
        ok: true,
        account: accountFromRow({ ...accountRow, email: token.email, updated_at: now }),
        session,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private countAccountsSync(handle: SqliteDatabaseHandle): number {
    const row = handle.sqlite.prepare('SELECT count(*) AS count FROM accounts').get() as {
      count: number;
    };
    return row.count;
  }

  private findAccountByIdSync(
    handle: SqliteDatabaseHandle,
    accountId: string
  ): SessionAccount | null {
    const row = handle.sqlite.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
      | AccountDbRow
      | undefined;
    return row ? accountFromRow(row) : null;
  }

  private findAccountByEmailSync(
    handle: SqliteDatabaseHandle,
    email: string
  ): SessionAccount | null {
    const row = handle.sqlite.prepare('SELECT * FROM accounts WHERE email = ?').get(email) as
      | AccountDbRow
      | undefined;
    return row ? accountFromRow(row) : null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON2ID_PASSWORD_PARAMS);
}

export async function verifyPasswordIfHashExists(
  passwordHash: string | null,
  password: string
): Promise<boolean> {
  if (!passwordHash) {
    return false;
  }
  try {
    return await argonVerify(passwordHash, password);
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createBotApiKey(): string {
  return `aa_bot_${nanoid(32)}`;
}

export function accountToCloudAccount(account: SessionAccount): Account {
  return { id: account.id, email: account.email, suspendedAt: account.suspendedAt };
}

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function accountFromRow(row: AccountDbRow): SessionAccount {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    suspendedAt: row.suspended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function botFromRow(row: BotDbRow): BotRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    byline: row.byline,
    apiKeyLast4: row.api_key_last4,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function insertSession(
  db: DatabaseHandle,
  accountId: string,
  session: NewSessionMaterial
): Promise<void> {
  if (db.dialect === 'sqlite') {
    insertSqliteSession(db, accountId, session);
    return;
  }

  await db.pool.query(
    `
      INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
      VALUES ($1, $2, $3, $4, NULL)
    `,
    [session.tokenHash, accountId, session.createdAt, session.expiresAt]
  );
}

function insertSqliteSession(
  handle: SqliteDatabaseHandle,
  accountId: string,
  session: NewSessionMaterial
): void {
  handle.sqlite
    .prepare(
      `
        INSERT INTO sessions (id, account_id, created_at, expires_at, last_seen_at)
        VALUES (?, ?, ?, ?, NULL)
      `
    )
    .run(session.tokenHash, accountId, session.createdAt, session.expiresAt);
}

async function insertBot(db: DatabaseHandle, bot: BotRecord, apiKey: string): Promise<void> {
  if (db.dialect === 'sqlite') {
    insertSqliteBot(db, bot, apiKey);
    return;
  }

  await insertPostgresBot(db.pool, bot, apiKey);
}

function insertSqliteBot(handle: SqliteDatabaseHandle, bot: BotRecord, apiKey: string): void {
  handle.sqlite
    .prepare(
      `
        INSERT INTO bots (
          id, account_id, name, byline, api_key_hash, api_key_last4,
          last_used_at, revoked_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
      `
    )
    .run(
      bot.id,
      bot.accountId,
      bot.name,
      bot.byline,
      hashSecret(apiKey),
      bot.apiKeyLast4,
      bot.createdAt,
      bot.updatedAt
    );
}

async function insertPostgresBot(
  executor: PostgresDatabaseHandle['pool'] | PoolClient,
  bot: BotRecord,
  apiKey: string
): Promise<void> {
  await executor.query(
    `
      INSERT INTO bots (
        id, account_id, name, byline, api_key_hash, api_key_last4,
        last_used_at, revoked_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, $7, $8)
    `,
    [
      bot.id,
      bot.accountId,
      bot.name,
      bot.byline,
      hashSecret(apiKey),
      bot.apiKeyLast4,
      bot.createdAt,
      bot.updatedAt,
    ]
  );
}

async function selectVerifiedBot(
  db: DatabaseHandle,
  apiKeyHash: string
): Promise<VerifiedBotRow | null> {
  const sqliteSql = `
    SELECT b.*, a.email AS account_email, a.suspended_at AS account_suspended_at
    FROM bots b
    JOIN accounts a ON a.id = b.account_id
    WHERE b.api_key_hash = ?
  `;
  if (db.dialect === 'sqlite') {
    const row = db.sqlite.prepare(sqliteSql).get(apiKeyHash) as VerifiedBotRow | undefined;
    return row ?? null;
  }

  const result = await db.pool.query<VerifiedBotRow>(sqliteSql.replace('?', '$1'), [apiKeyHash]);
  return result.rows[0] ?? null;
}

async function selectAccountByIdPostgres(
  handle: PostgresDatabaseHandle,
  accountId: string
): Promise<SessionAccount | null> {
  const result = await handle.pool.query<AccountDbRow>('SELECT * FROM accounts WHERE id = $1', [
    accountId,
  ]);
  return result.rows[0] ? accountFromRow(result.rows[0]) : null;
}

async function selectAccountByEmailPostgres(
  handle: PostgresDatabaseHandle,
  email: string
): Promise<SessionAccount | null> {
  const result = await handle.pool.query<AccountDbRow>('SELECT * FROM accounts WHERE email = $1', [
    email,
  ]);
  return result.rows[0] ? accountFromRow(result.rows[0]) : null;
}
