/**
 * Безопасное локальное хранилище
 * Использует IndexedDB с шифрованием для хранения ключей
 */

import { get, set, del, clear } from "idb-keyval";
import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import type { IdentityKeys, KeyPair } from "./keys";
import type { SerializedSession } from "./ratchet";
import type { Chat } from "@/stores";

const STORAGE_KEYS = {
  IDENTITY: "identity_keys",
  CONTACTS: "contacts",
  CHATS: "chats",
  SESSIONS: "sessions",
  PREKEYS: "prekeys",
  SETTINGS: "settings",
  PIN_HASH: "pin_hash",
  ENCRYPTION_SALT: "encryption_salt",
  HIDDEN_CHAT_PIN: "hidden_chat_pin",
  LOCKOUT: "lockout_state",
} as const;

interface EncryptedDataV1 {
  ciphertext: string;
  nonce: string;
  salt: string;
}

interface EncryptedDataV2 {
  v: 2;
  ciphertext: string;
  nonce: string;
}

type EncryptedData = EncryptedDataV1 | EncryptedDataV2;

interface BackupEnvelope {
  v: 1;
  salt: string;
  nonce: string;
  ciphertext: string;
}

// Helper functions for UTF8 encoding/decoding
function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function uint8ArrayToString(arr: Uint8Array): string {
  return new TextDecoder().decode(arr);
}

/**
 * Генерирует ключ шифрования из PIN или пароля
 */
async function deriveKeyFromPin(
  pin: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const pinBytes = stringToUint8Array(pin);

  // Create ArrayBuffer copies to avoid SharedArrayBuffer type issues
  const pinBuffer = new ArrayBuffer(pinBytes.length);
  new Uint8Array(pinBuffer).set(pinBytes);

  const saltBuffer = new ArrayBuffer(salt.length);
  new Uint8Array(saltBuffer).set(salt);

  // Используем PBKDF2 через Web Crypto API
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    pinBuffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return new Uint8Array(derivedBits);
}

/**
 * Расшифровывает данные с использованием PIN
 */
async function decryptWithPin(
  encrypted: EncryptedDataV1,
  pin: string,
): Promise<string | null> {
  const salt = decodeBase64(encrypted.salt);
  const key = await deriveKeyFromPin(pin, salt);
  const nonce = decodeBase64(encrypted.nonce);
  const ciphertext = decodeBase64(encrypted.ciphertext);

  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);

  if (!decrypted) {
    return null;
  }

  return uint8ArrayToString(decrypted);
}

async function getOrCreateEncryptionSalt(): Promise<Uint8Array> {
  const existing = await get<string>(STORAGE_KEYS.ENCRYPTION_SALT);
  if (existing) {
    try {
      const decoded = decodeBase64(existing);
      if (decoded.length === 16) return decoded;
    } catch {
      // fallthrough to regenerate
    }
  }

  const salt = nacl.randomBytes(16);
  await set(STORAGE_KEYS.ENCRYPTION_SALT, encodeBase64(salt));
  return salt;
}

let cachedMasterKey: { pin: string; saltB64: string; key: Uint8Array } | null =
  null;

/**
 * Clears the in-memory cached master key. Must be called on logout / clearAuth.
 */
export function clearCachedMasterKey(): void {
  cachedMasterKey = null;
}

async function getMasterKey(pin: string): Promise<Uint8Array> {
  const salt = await getOrCreateEncryptionSalt();
  const saltB64 = encodeBase64(salt);

  if (
    cachedMasterKey &&
    cachedMasterKey.pin === pin &&
    cachedMasterKey.saltB64 === saltB64
  ) {
    return cachedMasterKey.key;
  }

  const key = await deriveKeyFromPin(pin, salt);
  cachedMasterKey = { pin, saltB64, key };
  return key;
}

async function encryptForStorage(
  data: string,
  pin: string,
): Promise<EncryptedDataV2> {
  const key = await getMasterKey(pin);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const messageBytes = stringToUint8Array(data);
  const ciphertext = nacl.secretbox(messageBytes, nonce, key);

  return {
    v: 2,
    ciphertext: encodeBase64(ciphertext),
    nonce: encodeBase64(nonce),
  };
}

async function decryptFromStorage(
  encrypted: EncryptedData,
  pin: string,
): Promise<string | null> {
  if ((encrypted as EncryptedDataV2).v === 2) {
    const key = await getMasterKey(pin);
    const nonce = decodeBase64((encrypted as EncryptedDataV2).nonce);
    const ciphertext = decodeBase64((encrypted as EncryptedDataV2).ciphertext);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
    return decrypted ? uint8ArrayToString(decrypted) : null;
  }

  return decryptWithPin(encrypted as EncryptedDataV1, pin);
}

/**
 * Сохраняет ключи идентификации
 */
export async function saveIdentityKeys(
  keys: IdentityKeys,
  pin: string,
): Promise<void> {
  const data = JSON.stringify(keys);
  const encrypted = await encryptForStorage(data, pin);
  await set(STORAGE_KEYS.IDENTITY, encrypted);

  // Сохраняем хеш PIN для проверки
  const pinBytes = stringToUint8Array(pin);
  const pinHash = nacl.hash(pinBytes);
  await set(STORAGE_KEYS.PIN_HASH, encodeBase64(pinHash));
}

/**
 * Загружает ключи идентификации
 */
export async function loadIdentityKeys(
  pin: string,
): Promise<IdentityKeys | null> {
  const encrypted = await get<EncryptedData>(STORAGE_KEYS.IDENTITY);

  if (!encrypted) {
    return null;
  }

  const decrypted = await decryptFromStorage(encrypted, pin);

  if (!decrypted) {
    return null;
  }

  try {
    return JSON.parse(decrypted) as IdentityKeys;
  } catch {
    // Decryption succeeded but payload is corrupted: reset only the affected keys.
    await del(STORAGE_KEYS.IDENTITY);
    await del(STORAGE_KEYS.PIN_HASH);
    return null;
  }
}

/**
 * Проверяет, существует ли аккаунт
 */
export async function hasAccount(): Promise<boolean> {
  const identity = await get(STORAGE_KEYS.IDENTITY);
  return identity !== undefined;
}

// ==================== Контакты ====================

export interface Contact {
  id: string;
  username: string;
  publicKey: string;
  exchangeKey: string;
  displayName?: string;
  addedAt: number;
  verified?: boolean;
  verifiedAt?: number;
  isHidden?: boolean;
}

/**
 * Сохраняет список контактов
 */
export async function saveContacts(
  contacts: Contact[],
  pin: string,
): Promise<void> {
  const data = JSON.stringify(contacts);
  const encrypted = await encryptForStorage(data, pin);
  await set(STORAGE_KEYS.CONTACTS, encrypted);
}

/**
 * Загружает список контактов
 */
export async function loadContacts(pin: string): Promise<Contact[]> {
  const encrypted = await get<EncryptedData>(STORAGE_KEYS.CONTACTS);

  if (!encrypted) {
    return [];
  }

  const decrypted = await decryptFromStorage(encrypted, pin);

  if (!decrypted) {
    return [];
  }

  try {
    const parsed = JSON.parse(decrypted) as unknown;
    return Array.isArray(parsed) ? (parsed as Contact[]) : [];
  } catch {
    await del(STORAGE_KEYS.CONTACTS);
    return [];
  }
}

// ==================== Chats ====================

export async function saveChats(chats: Chat[], pin: string): Promise<void> {
  const data = JSON.stringify(chats);
  const encrypted = await encryptForStorage(data, pin);
  await set(STORAGE_KEYS.CHATS, encrypted);
}

export async function loadChats(pin: string): Promise<Chat[]> {
  const encrypted = await get<EncryptedData>(STORAGE_KEYS.CHATS);

  if (!encrypted) {
    return [];
  }

  const decrypted = await decryptFromStorage(encrypted, pin);

  if (!decrypted) {
    return [];
  }

  try {
    const parsed = JSON.parse(decrypted) as unknown;
    return Array.isArray(parsed) ? (parsed as Chat[]) : [];
  } catch {
    await del(STORAGE_KEYS.CHATS);
    return [];
  }
}

// ==================== Prekeys (X3DH) ====================

export interface LocalPreKeyMaterial {
  signedPreKey: KeyPair;
  oneTimePreKeys: KeyPair[];
  updatedAt: number;
}

export async function savePreKeyMaterial(
  material: LocalPreKeyMaterial,
  pin: string,
): Promise<void> {
  const data = JSON.stringify(material);
  const encrypted = await encryptForStorage(data, pin);
  await set(STORAGE_KEYS.PREKEYS, encrypted);
}

export async function loadPreKeyMaterial(
  pin: string,
): Promise<LocalPreKeyMaterial | null> {
  const encrypted = await get<EncryptedData>(STORAGE_KEYS.PREKEYS);
  if (!encrypted) return null;

  const decrypted = await decryptFromStorage(encrypted, pin);
  if (!decrypted) return null;

  try {
    const parsed = JSON.parse(decrypted) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const material = parsed as LocalPreKeyMaterial;
    if (!material.signedPreKey || !Array.isArray(material.oneTimePreKeys))
      return null;
    return material;
  } catch {
    await del(STORAGE_KEYS.PREKEYS);
    return null;
  }
}

export async function consumeOneTimePreKey(
  publicKey: string,
  pin: string,
): Promise<KeyPair | null> {
  const material = await loadPreKeyMaterial(pin);
  if (!material) return null;

  const index = material.oneTimePreKeys.findIndex(
    (k) => k.publicKey === publicKey,
  );
  if (index < 0) return null;

  const [keyPair] = material.oneTimePreKeys.splice(index, 1);
  material.updatedAt = Date.now();
  await savePreKeyMaterial(material, pin);
  return keyPair;
}

// ==================== Сессии (Double Ratchet) ====================

export type RatchetSessions = Record<string, SerializedSession>;

export async function saveRatchetSessions(
  sessions: RatchetSessions,
  pin: string,
): Promise<void> {
  const data = JSON.stringify(sessions);
  const encrypted = await encryptForStorage(data, pin);
  await set(STORAGE_KEYS.SESSIONS, encrypted);
}

export async function loadRatchetSessions(
  pin: string,
): Promise<RatchetSessions> {
  const encrypted = await get<EncryptedData>(STORAGE_KEYS.SESSIONS);
  if (!encrypted) return {};

  const decrypted = await decryptFromStorage(encrypted, pin);
  if (!decrypted) return {};

  try {
    const parsed = JSON.parse(decrypted) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return parsed as RatchetSessions;
  } catch {
    await del(STORAGE_KEYS.SESSIONS);
    return {};
  }
}

export async function deleteRatchetSession(
  contactId: string,
  pin: string,
): Promise<void> {
  const sessions = await loadRatchetSessions(pin);
  if (!(contactId in sessions)) return;
  delete sessions[contactId];
  await saveRatchetSessions(sessions, pin);
}

// ==================== PIN Brute-force Protection ====================

let failedPinAttempts = 0;
let lockedUntil = 0;
let lockoutLoaded = false;

const LOCKOUT_THRESHOLDS = [
  { attempts: 3, lockSeconds: 15 },
  { attempts: 5, lockSeconds: 60 },
  { attempts: 8, lockSeconds: 300 },
  { attempts: 12, lockSeconds: 900 },
];

/**
 * Load lockout state from IDB (once). Survives page refresh.
 */
async function loadLockoutState(): Promise<void> {
  if (lockoutLoaded) return;
  lockoutLoaded = true;
  try {
    const state = await get<{ attempts: number; lockedUntil: number }>(STORAGE_KEYS.LOCKOUT);
    if (state) {
      failedPinAttempts = state.attempts;
      lockedUntil = state.lockedUntil;
    }
  } catch {
    // ignore
  }
}

async function persistLockoutState(): Promise<void> {
  try {
    await set(STORAGE_KEYS.LOCKOUT, { attempts: failedPinAttempts, lockedUntil });
  } catch {
    // ignore
  }
}

async function checkPinLockout(): Promise<void> {
  await loadLockoutState();
  if (lockedUntil > Date.now()) {
    const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
    throw new Error(`Too many attempts. Try again in ${remaining}s`);
  }
}

async function recordPinFailure(): Promise<void> {
  failedPinAttempts++;
  for (let i = LOCKOUT_THRESHOLDS.length - 1; i >= 0; i--) {
    if (failedPinAttempts >= LOCKOUT_THRESHOLDS[i].attempts) {
      lockedUntil = Date.now() + LOCKOUT_THRESHOLDS[i].lockSeconds * 1000;
      break;
    }
  }
  await persistLockoutState();
}

async function resetPinFailures(): Promise<void> {
  failedPinAttempts = 0;
  lockedUntil = 0;
  await persistLockoutState();
}

// ==================== Hidden Chat PIN Hashing ====================

/**
 * Хеширует PIN скрытых чатов через PBKDF2. Возвращает "salt:hash" (base64).
 */
export async function hashHiddenChatPin(pin: string): Promise<string> {
  const salt = nacl.randomBytes(16);
  const key = await deriveKeyFromPin(pin, salt);
  return `${encodeBase64(salt)}:${encodeBase64(key)}`;
}

/**
 * Проверяет PIN скрытых чатов против сохранённого хеша "salt:hash".
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyHiddenChatPin(
  input: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const salt = decodeBase64(parts[0]);
  const expectedBytes = decodeBase64(parts[1]);
  const derivedBytes = await deriveKeyFromPin(input, salt);

  // Constant-time comparison (XOR accumulator)
  if (expectedBytes.length !== derivedBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    diff |= expectedBytes[i] ^ derivedBytes[i];
  }
  return diff === 0;
}

// ==================== Настройки ====================

export interface Settings {
  username?: string;
  userId?: string;
  theme: "light" | "dark" | "system";
  notifications: boolean;
  selfDestructDefault: number | null;
  hiddenChatsEnabled: boolean;
  /** Hashed hidden chat PIN ("salt:hash" format) — never stored in plaintext */
  hiddenChatPinHash?: string;
}

const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  notifications: true,
  selfDestructDefault: null,
  hiddenChatsEnabled: false,
};

/**
 * Сохраняет настройки.
 * The hiddenChatPinHash is stored separately (encrypted with master PIN) for defense-in-depth.
 * Non-sensitive fields (theme, notifications, etc.) stay plaintext so they can be read pre-auth.
 */
export async function saveSettings(settings: Settings): Promise<void> {
  // Strip hiddenChatPinHash from plaintext store
  const { hiddenChatPinHash, ...safeSettings } = settings;
  await set(STORAGE_KEYS.SETTINGS, safeSettings);

  // If hiddenChatPinHash is explicitly set (even to undefined), persist to encrypted store
  if (hiddenChatPinHash !== undefined) {
    await set(STORAGE_KEYS.HIDDEN_CHAT_PIN, hiddenChatPinHash);
  }
}

/**
 * Загружает настройки.
 * Merges the encrypted hiddenChatPinHash back into the Settings object.
 */
export async function loadSettings(): Promise<Settings> {
  const settings = await get<Settings>(STORAGE_KEYS.SETTINGS);
  const base = settings || DEFAULT_SETTINGS;

  // Merge hidden chat PIN hash from separate store
  const hiddenChatPinHash = await get<string>(STORAGE_KEYS.HIDDEN_CHAT_PIN);
  if (hiddenChatPinHash) {
    return { ...base, hiddenChatPinHash };
  }
  return base;
}

// ==================== Panic Mode ====================

/**
 * Полностью очищает все данные (Panic Mode)
 */
export async function panicWipe(): Promise<void> {
  await clear();
  cachedMasterKey = null;

  // Очищаем также localStorage и sessionStorage
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.clear();
  }
}

/**
 * Удаляет только ключи (оставляет настройки)
 */
export async function deleteKeys(): Promise<void> {
  await del(STORAGE_KEYS.IDENTITY);
  await del(STORAGE_KEYS.SESSIONS);
  await del(STORAGE_KEYS.PREKEYS);
  await del(STORAGE_KEYS.PIN_HASH);
  cachedMasterKey = null;
}

/**
 * Удаляет контакт и его сессию
 */
export async function deleteContact(
  contactId: string,
  pin: string,
): Promise<void> {
  const contacts = await loadContacts(pin);
  const filtered = contacts.filter((c) => c.id !== contactId);
  await saveContacts(filtered, pin);

  await deleteRatchetSession(contactId, pin);
}

// ==================== Change PIN ====================

/**
 * Меняет PIN-код: расшифровывает все данные старым PIN, перешифровывает новым.
 * Выбрасывает ошибку если старый PIN неверный.
 */
export async function changePin(oldPin: string, newPin: string): Promise<void> {
  // Brute-force lockout check
  await checkPinLockout();

  // Verify old PIN by attempting to load identity keys
  const identity = await loadIdentityKeys(oldPin);
  if (!identity) {
    await recordPinFailure();
    throw new Error('Invalid current PIN');
  }

  // PIN verified — reset lockout counter
  await resetPinFailures();

  // Load all encrypted data with old PIN
  const contacts = await loadContacts(oldPin);
  const chats = await loadChats(oldPin);
  const sessions = await loadRatchetSessions(oldPin);
  const prekeys = await loadPreKeyMaterial(oldPin);

  // Generate a new encryption salt for v2 master key
  const newSalt = nacl.randomBytes(16);
  const newMasterKey = await deriveKeyFromPin(newPin, newSalt);

  // Store the new salt (used by v2 encrypt/decrypt)
  await set(STORAGE_KEYS.ENCRYPTION_SALT, encodeBase64(newSalt));

  // Clear cached master key so encryptForStorage picks up the new one
  cachedMasterKey = { pin: newPin, saltB64: encodeBase64(newSalt), key: newMasterKey };

  // Re-save everything with new PIN (new master key)
  await saveIdentityKeys(identity, newPin);
  await saveContacts(contacts, newPin);
  await saveChats(chats, newPin);
  await saveRatchetSessions(sessions, newPin);
  if (prekeys) {
    await savePreKeyMaterial(prekeys, newPin);
  }
}

// ==================== Backup / Restore ====================

/**
 * Экспортирует все чувствительные данные (ключи, контакты, чаты, сессии, prekeys, настройки)
 * в один зашифрованный бэкап. Формат: base64(JSON{v, salt, nonce, ciphertext}).
 */
export async function exportEncryptedBackup(pin: string): Promise<string> {
  const payload = {
    identity: await loadIdentityKeys(pin),
    contacts: await loadContacts(pin),
    chats: await loadChats(pin),
    sessions: await loadRatchetSessions(pin),
    prekeys: await loadPreKeyMaterial(pin),
    settings: await loadSettings(),
  };

  const salt = nacl.randomBytes(16);
  const key = await deriveKeyFromPin(pin, salt);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const plaintext = stringToUint8Array(JSON.stringify(payload));
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  const envelope: BackupEnvelope = {
    v: 1,
    salt: encodeBase64(salt),
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(ciphertext),
  };

  return encodeBase64(stringToUint8Array(JSON.stringify(envelope)));
}

/**
 * Импортирует бэкап, созданный exportEncryptedBackup. Полностью очищает локальное хранилище.
 */
export async function importEncryptedBackup(
  encoded: string,
  pin: string,
): Promise<void> {
  let envelope: BackupEnvelope;
  try {
    const json = uint8ArrayToString(decodeBase64(encoded));
    envelope = JSON.parse(json) as BackupEnvelope;
    if (
      envelope.v !== 1 ||
      !envelope.salt ||
      !envelope.nonce ||
      !envelope.ciphertext
    ) {
      throw new Error("Invalid envelope");
    }
  } catch {
    throw new Error("Неверный формат бэкапа");
  }

  const salt = decodeBase64(envelope.salt);
  const nonce = decodeBase64(envelope.nonce);
  const ciphertext = decodeBase64(envelope.ciphertext);
  const key = await deriveKeyFromPin(pin, salt);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);
  if (!decrypted) {
    throw new Error("Не удалось расшифровать бэкап (PIN?)");
  }

  let payload: {
    identity: IdentityKeys | null;
    contacts: Contact[];
    chats: Chat[];
    sessions: RatchetSessions;
    prekeys: LocalPreKeyMaterial | null;
    settings: Settings;
  };

  try {
    payload = JSON.parse(uint8ArrayToString(decrypted));
  } catch {
    throw new Error("Поврежденное содержимое бэкапа");
  }

  // Полная очистка
  await panicWipe();

  // Восстановление
  if (payload.identity) {
    await saveIdentityKeys(payload.identity, pin);
  }
  if (payload.prekeys) {
    await savePreKeyMaterial(payload.prekeys, pin);
  }
  await saveContacts(payload.contacts || [], pin);
  await saveChats(payload.chats || [], pin);
  await saveRatchetSessions(payload.sessions || {}, pin);
  await saveSettings(payload.settings || DEFAULT_SETTINGS);
}
