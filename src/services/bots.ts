import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { DatabaseHandle, PostgresDatabaseHandle, SqliteDatabaseHandle } from '../db/client.js';
import type { Account, CloudModule } from '../extension/cloud-module.js';
import { ServiceError } from './errors.js';

export interface CreateBotInput {
  db: DatabaseHandle;
  extension: CloudModule;
  account: Account;
  name: string;
  byline?: string | null;
}

export interface CreatedBot {
  id: string;
  accountId: string;
  name: string;
  byline: string | null;
  apiKey: string;
  apiKeyLast4: string;
  createdAt: number;
  updatedAt: number;
}

export async function createBot(input: CreateBotInput): Promise<CreatedBot> {
  const quota = await input.extension.checkQuota(input.account, { type: 'create_bot' });
  if (!quota.allow) {
    throw new ServiceError(403, 'quota_exceeded', quota.message, { code: quota.code });
  }

  const now = Date.now();
  const apiKey = `aa_bot_${nanoid(32)}`;
  const apiKeyHash = hashSecret(apiKey);
  const apiKeyLast4 = apiKey.slice(-4);
  const bot: CreatedBot = {
    id: `bot_${nanoid(21)}`,
    accountId: input.account.id,
    name: input.name,
    byline: input.byline ?? null,
    apiKey,
    apiKeyLast4,
    createdAt: now,
    updatedAt: now,
  };

  if (input.db.dialect === 'sqlite') {
    insertSqliteBot(input.db, bot, apiKeyHash);
  } else {
    await insertPostgresBot(input.db, bot, apiKeyHash);
  }

  return bot;
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function insertSqliteBot(handle: SqliteDatabaseHandle, bot: CreatedBot, apiKeyHash: string): void {
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
      apiKeyHash,
      bot.apiKeyLast4,
      bot.createdAt,
      bot.updatedAt
    );
}

async function insertPostgresBot(
  handle: PostgresDatabaseHandle,
  bot: CreatedBot,
  apiKeyHash: string
): Promise<void> {
  await handle.pool.query(
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
      apiKeyHash,
      bot.apiKeyLast4,
      bot.createdAt,
      bot.updatedAt,
    ]
  );
}
