import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../src/services/auth.js';

/**
 * Re-creates the QA fixtures registered in qa/fixtures.md. Idempotent: it resets the password on an
 * existing fixture account rather than duplicating it, and only seeds sacrificial content when the
 * account has none. Run with QA_FIXTURE_PASSWORD set; it never prints the password.
 *
 *   QA_FIXTURE_PASSWORD=... pnpm exec tsx qa/provision-fixtures.ts
 */

const DB = 'data/agent-artifacts.db';
const PASSWORD = process.env.QA_FIXTURE_PASSWORD;
if (!PASSWORD) throw new Error('QA_FIXTURE_PASSWORD not set');

const id = (p: string) => `${p}_${randomBytes(12).toString('base64url')}`;
const now = () => Date.now();
const db = new DatabaseSync(DB);
const hash = await hashPassword(PASSWORD);

function upsertAccount(email: string): string {
  const found = db.prepare('select id from accounts where email = ?').get(email) as
    | { id?: string }
    | undefined;
  if (found?.id) {
    db.prepare(
      'update accounts set password_hash=?, suspended_at=null, updated_at=? where id=?'
    ).run(hash, now(), found.id);
    return found.id;
  }
  const accountId = id('acc');
  db.prepare(
    'insert into accounts (id,email,password_hash,created_at,updated_at) values (?,?,?,?,?)'
  ).run(accountId, email, hash, now(), now());
  return accountId;
}

const emptyId = upsertAccount('qa-empty-state@example.test');
const sacId = upsertAccount('qa-sacrificial@example.test');
// Separate from the content fixture ON PURPOSE: settings' account-level mutations change the email,
// change the password, or delete the account outright. Aimed at qa-sacrificial they would take the
// artifacts and bots with them, so account-level destruction gets its own body to destroy.
const acctId = upsertAccount('qa-sacrificial-account@example.test');
console.log('empty-state account   :', emptyId);
console.log('sacrificial account   :', sacId);
console.log('sacrificial-account   :', acctId);

// The empty fixture must STAY empty; assert rather than assume.
const emptyArts = (
  db
    .prepare('select count(*) c from artifacts where account_id=? and deleted_at is null')
    .get(emptyId) as { c: number }
).c;
const emptyBots = (
  db
    .prepare('select count(*) c from bots where account_id=? and revoked_at is null')
    .get(emptyId) as { c: number }
).c;
console.log(`empty fixture holds    : ${emptyArts} artifacts, ${emptyBots} bots`);

// Sacrificial content — built to be destroyed.
const existing = (
  db
    .prepare('select count(*) c from artifacts where account_id=? and deleted_at is null')
    .get(sacId) as { c: number }
).c;
if (existing === 0) {
  for (let n = 1; n <= 3; n += 1) {
    const artId = id('art');
    const body = `# Disposable artifact ${n}\n\nBuilt to be deleted. Destroying this costs nothing.`;
    const ch = createHash('sha256').update(body).digest('hex');
    db.prepare(`insert into artifacts (id,account_id,slug,type,title,content,content_hash,metadata,version_num,created_at,updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?)`).run(
      artId,
      sacId,
      `disposable-${n}`,
      'markdown',
      `Disposable artifact ${n}`,
      body,
      ch,
      '{}',
      1,
      now(),
      now()
    );
    // artifact 1 gets a version history so promote/restore has something to act on
    const versions = n === 1 ? 3 : 1;
    for (let v = 1; v <= versions; v += 1) {
      const vb = `${body}\n\nRevision ${v}.`;
      db.prepare(`insert into artifact_versions (artifact_id,version_num,type,title,content,content_hash,change_summary,created_at)
                  values (?,?,?,?,?,?,?,?)`).run(
        artId,
        v,
        'markdown',
        `Disposable artifact ${n}`,
        vb,
        createHash('sha256').update(vb).digest('hex'),
        `disposable revision ${v}`,
        now()
      );
    }
    if (versions > 1)
      db.prepare('update artifacts set version_num=? where id=?').run(versions, artId);
  }
  for (let b = 1; b <= 2; b += 1) {
    const key = `aa_bot_${randomBytes(18).toString('base64url')}`;
    db.prepare(`insert into bots (id,account_id,name,byline,api_key_hash,api_key_last4,created_at,updated_at)
                values (?,?,?,?,?,?,?,?)`).run(
      id('bot'),
      sacId,
      `Disposable bot ${b}`,
      'safe to revoke or regenerate',
      createHash('sha256').update(key).digest('hex'),
      key.slice(-4),
      now(),
      now()
    );
  }
}
// A little content so deleting the account exercises the cascade rather than removing an empty row.
const acctArts = (
  db
    .prepare('select count(*) c from artifacts where account_id=? and deleted_at is null')
    .get(acctId) as { c: number }
).c;
if (acctArts === 0) {
  const artId = id('art');
  const body =
    '# Cascade check\n\nThis exists so deleting the account has something to take with it.';
  const bodyHash = createHash('sha256').update(body).digest('hex');
  db.prepare(
    `insert into artifacts (id,account_id,slug,type,title,content,content_hash,metadata,version_num,created_at,updated_at)
     values (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    artId,
    acctId,
    'cascade-check',
    'markdown',
    'Cascade check',
    body,
    bodyHash,
    '{}',
    1,
    now(),
    now()
  );
  db.prepare(
    `insert into artifact_versions (artifact_id,version_num,type,title,content,content_hash,change_summary,created_at)
     values (?,?,?,?,?,?,?,?)`
  ).run(artId, 1, 'markdown', 'Cascade check', body, bodyHash, 'seed', now());
  const cascadeKey = `aa_bot_${randomBytes(18).toString('base64url')}`;
  db.prepare(
    `insert into bots (id,account_id,name,byline,api_key_hash,api_key_last4,created_at,updated_at)
     values (?,?,?,?,?,?,?,?)`
  ).run(
    id('bot'),
    acctId,
    'Cascade bot',
    'goes with the account',
    createHash('sha256').update(cascadeKey).digest('hex'),
    cascadeKey.slice(-4),
    now(),
    now()
  );
}
const acctFinal = (
  db
    .prepare('select count(*) c from artifacts where account_id=? and deleted_at is null')
    .get(acctId) as { c: number }
).c;
console.log(`account fixture holds  : ${acctFinal} artifact(s) + 1 bot, for the delete cascade`);

const sacArts = (
  db
    .prepare('select count(*) c from artifacts where account_id=? and deleted_at is null')
    .get(sacId) as { c: number }
).c;
const sacBots = (
  db
    .prepare('select count(*) c from bots where account_id=? and revoked_at is null')
    .get(sacId) as { c: number }
).c;
const sacVers = (
  db
    .prepare(
      'select count(*) c from artifact_versions v join artifacts a on a.id=v.artifact_id where a.account_id=?'
    )
    .get(sacId) as { c: number }
).c;
console.log(`sacrificial holds      : ${sacArts} artifacts, ${sacVers} versions, ${sacBots} bots`);
db.close();
