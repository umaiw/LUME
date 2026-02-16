/**
 * SQLite Database Setup
 * Minimal storage: public keys, prekeys, and pending messages.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DEFAULT_DB_PATH = path.join(__dirname, "../../data/messenger.db");
const DB_PATH = (process.env.DB_PATH || DEFAULT_DB_PATH).trim();
const RESOLVED_DB_PATH =
  DB_PATH === ":memory:" ? DB_PATH : path.resolve(DB_PATH);

if (RESOLVED_DB_PATH !== ":memory:") {
  fs.mkdirSync(path.dirname(RESOLVED_DB_PATH), { recursive: true });
}

const db = new Database(RESOLVED_DB_PATH);

// Pragmas
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 3000");

// ==================== Tables ====================

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    identity_key TEXT NOT NULL,
    exchange_identity_key TEXT,
    signed_prekey TEXT NOT NULL,
    signed_prekey_signature TEXT NOT NULL,
    push_token TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_seen INTEGER
  );

  CREATE TABLE IF NOT EXISTS one_time_prekeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pending_messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    encrypted_payload TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS request_signatures (
    request_hash TEXT PRIMARY KEY,
    identity_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_identity_key_unique ON users(identity_key);
  CREATE INDEX IF NOT EXISTS idx_prekeys_user ON one_time_prekeys(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_recipient ON pending_messages(recipient_id);
  CREATE INDEX IF NOT EXISTS idx_request_signatures_created_at ON request_signatures(created_at);

  CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ==================== Lightweight migrations ====================
// Older DBs were created before `exchange_identity_key` existed.
// Ensure the column exists before creating the unique index.
try {
  const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{
    name: string;
  }>;
  const hasExchange = userColumns.some(
    (col) => col.name === "exchange_identity_key",
  );

  if (!hasExchange) {
    db.exec(`ALTER TABLE users ADD COLUMN exchange_identity_key TEXT`);
  }

  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_exchange_identity_key_unique ON users(exchange_identity_key)`,
  );

  // Backfill for existing rows (safe to run repeatedly).
  db.exec(
    `UPDATE users SET exchange_identity_key = signed_prekey WHERE exchange_identity_key IS NULL`,
  );
} catch (migrationError) {
  // Acceptable: new DBs will still be created correctly above.
  // Log for debugging if the migration query itself is broken.
  if (process.env.LOG_SECURITY === "1") {
    console.warn("[db] Migration skipped:", migrationError);
  }
}

// ==================== Prepared Statements ====================

const insertUser = db.prepare(`
  INSERT INTO users (id, username, identity_key, exchange_identity_key, signed_prekey, signed_prekey_signature)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const findUserByUsername = db.prepare(`
  SELECT * FROM users WHERE username = ?
`);

const findUserById = db.prepare(`
  SELECT * FROM users WHERE id = ?
`);

const findUserByIdentityKey = db.prepare(`
  SELECT * FROM users WHERE identity_key = ?
`);

const updatePushToken = db.prepare(`
  UPDATE users SET push_token = ? WHERE id = ?
`);

const updateLastSeen = db.prepare(`
  UPDATE users SET last_seen = strftime('%s', 'now') WHERE id = ?
`);

const updateSignedPrekey = db.prepare(`
  UPDATE users
  SET signed_prekey = ?, signed_prekey_signature = ?
  WHERE id = ?
`);

const deleteUser = db.prepare(`
  DELETE FROM users WHERE id = ?
`);

const insertPrekey = db.prepare(`
  INSERT OR IGNORE INTO one_time_prekeys (id, user_id, public_key)
  VALUES (?, ?, ?)
`);

const getAndDeletePrekey = db.prepare(`
  DELETE FROM one_time_prekeys
  WHERE id = (
    SELECT id FROM one_time_prekeys
    WHERE user_id = ?
    ORDER BY created_at ASC
    LIMIT 1
  )
  RETURNING public_key
`);

const peekPrekey = db.prepare(`
  SELECT public_key FROM one_time_prekeys
  WHERE user_id = ?
  ORDER BY created_at ASC
  LIMIT 1
`);

const countPrekeys = db.prepare(`
  SELECT COUNT(*) as count FROM one_time_prekeys WHERE user_id = ?
`);

const insertMessage = db.prepare(`
  INSERT INTO pending_messages (id, sender_id, recipient_id, encrypted_payload)
  VALUES (?, ?, ?, ?)
`);

const getPendingMessages = db.prepare(`
  SELECT * FROM pending_messages WHERE recipient_id = ? ORDER BY created_at ASC
`);

const getMessageById = db.prepare(`
  SELECT * FROM pending_messages WHERE id = ?
`);

const deleteMessage = db.prepare(`
  DELETE FROM pending_messages WHERE id = ?
`);

const deleteUserMessages = db.prepare(`
  DELETE FROM pending_messages WHERE recipient_id = ?
`);

const deleteStaleMessages = db.prepare(`
  DELETE FROM pending_messages WHERE created_at < ?
`);

const insertRequestSignature = db.prepare(`
  INSERT OR IGNORE INTO request_signatures (request_hash, identity_key)
  VALUES (?, ?)
`);

const cleanupOldRequestSignatures = db.prepare(`
  DELETE FROM request_signatures WHERE created_at < ?
`);

const insertBlock = db.prepare(`
  INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id)
  VALUES (?, ?)
`);

const removeBlock = db.prepare(`
  DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?
`);

const checkBlocked = db.prepare(`
  SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ? LIMIT 1
`);

const getBlockedByUser = db.prepare(`
  SELECT blocked_id FROM blocked_users WHERE blocker_id = ?
`);

export interface User {
  id: string;
  username: string;
  identity_key: string;
  exchange_identity_key: string | null;
  signed_prekey: string;
  signed_prekey_signature: string;
  push_token: string | null;
  created_at: number;
  last_seen: number | null;
}

// Cache for getUsersByIds prepared statements keyed by number of IDs.
const getUsersByIdsCache = new Map<number, ReturnType<typeof db.prepare>>();

export interface PendingMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  encrypted_payload: string;
  created_at: number;
}

export const database = {
  createUser(
    id: string,
    username: string,
    identityKey: string,
    exchangeIdentityKey: string,
    signedPrekey: string,
    signedPrekeySignature: string,
  ): void {
    insertUser.run(
      id,
      username,
      identityKey,
      exchangeIdentityKey,
      signedPrekey,
      signedPrekeySignature,
    );
  },

  getUserByUsername(username: string): User | undefined {
    return findUserByUsername.get(username) as User | undefined;
  },

  getUserById(id: string): User | undefined {
    return findUserById.get(id) as User | undefined;
  },

  getUserByIdentityKey(identityKey: string): User | undefined {
    return findUserByIdentityKey.get(identityKey) as User | undefined;
  },

  setPushToken(userId: string, token: string): void {
    updatePushToken.run(token, userId);
  },

  touchLastSeen(userId: string): void {
    updateLastSeen.run(userId);
  },

  setSignedPrekey(
    userId: string,
    signedPrekey: string,
    signedPrekeySignature: string,
  ): void {
    updateSignedPrekey.run(signedPrekey, signedPrekeySignature, userId);
  },

  deleteUser(userId: string): void {
    deleteUser.run(userId);
  },

  addPrekeys(
    userId: string,
    prekeys: Array<{ id: string; publicKey: string }>,
  ): void {
    const insertMany = db.transaction((keys: typeof prekeys) => {
      for (const key of keys) {
        insertPrekey.run(`${userId}:${key.id}`, userId, key.publicKey);
      }
    });
    insertMany(prekeys);
  },

  peekPrekey(userId: string): string | null {
    const result = peekPrekey.get(userId) as { public_key: string } | undefined;
    return result?.public_key ?? null;
  },

  consumePrekey(userId: string): string | null {
    const result = getAndDeletePrekey.get(userId) as
      | { public_key: string }
      | undefined;
    return result?.public_key ?? null;
  },

  getPrekeyCount(userId: string): number {
    const result = countPrekeys.get(userId) as { count: number };
    return result.count;
  },

  queueMessage(
    id: string,
    senderId: string,
    recipientId: string,
    encryptedPayload: string,
  ): void {
    insertMessage.run(id, senderId, recipientId, encryptedPayload);
  },

  getPendingMessages(recipientId: string): PendingMessage[] {
    return getPendingMessages.all(recipientId) as PendingMessage[];
  },

  getUsersByIds(userIds: string[]): User[] {
    if (userIds.length === 0) return [];
    // Cache prepared statements by arity to avoid re-preparing on every call.
    const key = userIds.length;
    if (!getUsersByIdsCache.has(key)) {
      const placeholders = userIds.map(() => "?").join(", ");
      getUsersByIdsCache.set(
        key,
        db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`),
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (getUsersByIdsCache.get(key)!.all as (...p: any[]) => unknown[])(
      ...userIds,
    ) as User[];
  },

  getMessageById(messageId: string): PendingMessage | undefined {
    return getMessageById.get(messageId) as PendingMessage | undefined;
  },

  deleteMessage(messageId: string): void {
    deleteMessage.run(messageId);
  },

  /**
   * Batch-delete messages in a single transaction.
   * Only deletes messages that belong to the given recipientId.
   * Returns the number of actually deleted messages.
   */
  batchDeleteMessages(messageIds: string[], recipientId: string): number {
    const batchDel = db.transaction((ids: string[]) => {
      let deleted = 0;
      for (const id of ids) {
        const msg = getMessageById.get(id) as PendingMessage | undefined;
        if (msg && msg.recipient_id === recipientId) {
          deleteMessage.run(id);
          deleted++;
        }
      }
      return deleted;
    });
    return batchDel(messageIds);
  },

  deleteAllMessages(recipientId: string): void {
    deleteUserMessages.run(recipientId);
  },

  /**
   * Удаляет сообщения старше указанного количества секунд.
   * Возвращает количество удалённых сообщений.
   */
  purgeStaleMessages(maxAgeSec: number): number {
    const cutoff = Math.floor(Date.now() / 1000) - maxAgeSec;
    const result = deleteStaleMessages.run(cutoff);
    return result.changes;
  },

  rememberRequestSignature(requestHash: string, identityKey: string): boolean {
    const nowSec = Math.floor(Date.now() / 1000);
    const ttlSec = 120;
    const result = db.transaction(() => {
      cleanupOldRequestSignatures.run(nowSec - ttlSec);
      return insertRequestSignature.run(requestHash, identityKey);
    })();
    return result.changes > 0;
  },

  // ── Blocking ──

  blockUser(blockerId: string, blockedId: string): void {
    insertBlock.run(blockerId, blockedId);
  },

  unblockUser(blockerId: string, blockedId: string): void {
    removeBlock.run(blockerId, blockedId);
  },

  isBlocked(blockerId: string, blockedId: string): boolean {
    return !!checkBlocked.get(blockerId, blockedId);
  },

  getBlockedUsers(userId: string): string[] {
    const rows = getBlockedByUser.all(userId) as Array<{ blocked_id: string }>;
    return rows.map((r) => r.blocked_id);
  },

  close(): void {
    db.close();
  },
};

export default database;
