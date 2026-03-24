/**
 * Tests for crypto/storage.ts
 * Covers: key derivation, encrypt/decrypt roundtrip, PIN verification,
 * identity key storage, contacts storage, changePin, panicWipe, edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Reset IDB between tests — fake-indexeddb/auto creates a fresh global each import,
// but we need to clear the stores between tests.
import { clear } from 'idb-keyval';

import {
  deriveMasterKeyFromPin,
  clearCachedMasterKey,
  savePinHash,
  saveIdentityKeys,
  loadIdentityKeys,
  saveContacts,
  loadContacts,
  saveChats,
  loadChats,
  saveRatchetSessions,
  loadRatchetSessions,
  savePreKeyMaterial,
  loadPreKeyMaterial,
  panicWipe,
  changePin,
  hasAccount,
  deleteKeys,
  deleteContact,
  hashHiddenChatPin,
  verifyHiddenChatPin,
  isLegacyHiddenPinHash,
  type Contact,
  type LocalPreKeyMaterial,
  type RatchetSessions,
} from '@/crypto/storage';
import type { IdentityKeys } from '@/crypto/keys';
import { generateIdentityKeys, generateExchangeKeyPair } from '@/crypto/keys';
import type { Chat } from '@/stores';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeContact(id: string): Contact {
  return {
    id,
    username: `user_${id}`,
    publicKey: 'pubkey_' + id,
    exchangeKey: 'exchkey_' + id,
    addedAt: Date.now(),
  };
}

function makeChat(id: string, contactId: string): Chat {
  return {
    id,
    contactId,
    messages: [],
    unreadCount: 0,
    isHidden: false,
  };
}

function makePreKeyMaterial(): LocalPreKeyMaterial {
  return {
    signedPreKey: generateExchangeKeyPair(),
    oneTimePreKeys: [generateExchangeKeyPair(), generateExchangeKeyPair()],
    updatedAt: Date.now(),
    spkCreatedAt: Date.now(),
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  clearCachedMasterKey();
  await clear();
});

// ── deriveKeyFromPin (via deriveMasterKeyFromPin) ────────────────────────────

describe('deriveMasterKeyFromPin', () => {
  it('returns a 32-byte Uint8Array', async () => {
    const key = await deriveMasterKeyFromPin('1234');
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('returns the same key for the same PIN (cached)', async () => {
    const key1 = await deriveMasterKeyFromPin('5678');
    const key2 = await deriveMasterKeyFromPin('5678');
    expect(key1).toBe(key2); // exact same reference (cached)
  });

  it('returns different keys for different PINs', async () => {
    const key1 = await deriveMasterKeyFromPin('1111');
    clearCachedMasterKey();
    // Need to clear salt to get truly different derivation with same salt —
    // but different PIN with same salt still produces different output
    const key2 = await deriveMasterKeyFromPin('2222');
    // Keys should differ (different PINs, same salt)
    const same = key1.every((b, i) => b === key2[i]);
    expect(same).toBe(false);
  });
});

// ── savePinHash / verifyPin (PBKDF2-based) ───────────────────────────────────

describe('savePinHash / PIN verification via identity keys', () => {
  it('saves PIN hash and identity keys; correct PIN loads them back', async () => {
    const pin = '9876';
    const masterKey = await deriveMasterKeyFromPin(pin);
    const keys = generateIdentityKeys();

    await savePinHash(pin);
    await saveIdentityKeys(keys, masterKey);

    // Reload with correct key
    const loaded = await loadIdentityKeys(masterKey);
    expect(loaded).not.toBeNull();
    expect(loaded!.signing.publicKey).toBe(keys.signing.publicKey);
    expect(loaded!.exchange.publicKey).toBe(keys.exchange.publicKey);
  });

  it('wrong PIN produces wrong masterKey, cannot decrypt identity keys', async () => {
    const correctPin = '1234';
    const masterKey = await deriveMasterKeyFromPin(correctPin);
    const keys = generateIdentityKeys();

    await savePinHash(correctPin);
    await saveIdentityKeys(keys, masterKey);

    // Derive a key with wrong PIN
    clearCachedMasterKey();
    await clear(); // clear salt so new derivation uses new salt
    const wrongKey = await deriveMasterKeyFromPin('0000');

    const loaded = await loadIdentityKeys(wrongKey);
    expect(loaded).toBeNull();
  });
});

// ── saveIdentityKeys / loadIdentityKeys roundtrip ────────────────────────────

describe('saveIdentityKeys / loadIdentityKeys', () => {
  it('roundtrip: save then load returns identical keys', async () => {
    const masterKey = await deriveMasterKeyFromPin('test');
    const keys = generateIdentityKeys();

    await saveIdentityKeys(keys, masterKey);
    const loaded = await loadIdentityKeys(masterKey);

    expect(loaded).toEqual(keys);
  });

  it('returns null when nothing is stored', async () => {
    const masterKey = await deriveMasterKeyFromPin('test');
    const loaded = await loadIdentityKeys(masterKey);
    expect(loaded).toBeNull();
  });
});

// ── saveContacts / loadContacts roundtrip ────────────────────────────────────

describe('saveContacts / loadContacts', () => {
  it('roundtrip: save then load returns identical contacts', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const contacts = [makeContact('a'), makeContact('b')];

    await saveContacts(contacts, masterKey);
    const loaded = await loadContacts(masterKey);

    expect(loaded).toEqual(contacts);
  });

  it('returns empty array when nothing is stored', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const loaded = await loadContacts(masterKey);
    expect(loaded).toEqual([]);
  });

  it('handles empty array', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    await saveContacts([], masterKey);
    const loaded = await loadContacts(masterKey);
    expect(loaded).toEqual([]);
  });
});

// ── saveChats / loadChats roundtrip ──────────────────────────────────────────

describe('saveChats / loadChats', () => {
  it('roundtrip works correctly', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const chats = [makeChat('c1', 'contact1'), makeChat('c2', 'contact2')];

    await saveChats(chats, masterKey);
    const loaded = await loadChats(masterKey);

    expect(loaded).toEqual(chats);
  });
});

// ── saveRatchetSessions / loadRatchetSessions ────────────────────────────────

describe('saveRatchetSessions / loadRatchetSessions', () => {
  it('roundtrip works correctly', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const sessions: RatchetSessions = {
      contact1: {
        dhSendingKeyPair: generateExchangeKeyPair(),
        dhReceivingPublicKey: 'recvpub',
        rootKey: 'rootkey_base64',
        sendingChainKey: 'sck_base64',
        receivingChainKey: 'rck_base64',
        sendingMessageNumber: 5,
        receivingMessageNumber: 3,
        previousSendingChainLength: 2,
        skippedMessageKeys: [],
      },
    };

    await saveRatchetSessions(sessions, masterKey);
    const loaded = await loadRatchetSessions(masterKey);

    expect(loaded).toEqual(sessions);
  });

  it('returns empty object when nothing stored', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const loaded = await loadRatchetSessions(masterKey);
    expect(loaded).toEqual({});
  });
});

// ── savePreKeyMaterial / loadPreKeyMaterial ───────────────────────────────────

describe('savePreKeyMaterial / loadPreKeyMaterial', () => {
  it('roundtrip works correctly', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const material = makePreKeyMaterial();

    await savePreKeyMaterial(material, masterKey);
    const loaded = await loadPreKeyMaterial(masterKey);

    expect(loaded).not.toBeNull();
    expect(loaded!.signedPreKey.publicKey).toBe(material.signedPreKey.publicKey);
    expect(loaded!.oneTimePreKeys.length).toBe(2);
  });
});

// ── changePin ────────────────────────────────────────────────────────────────

describe('changePin', () => {
  it('re-encrypts all data with new PIN; old PIN no longer works', async () => {
    const oldPin = '1111';
    const oldKey = await deriveMasterKeyFromPin(oldPin);
    const keys = generateIdentityKeys();
    const contacts = [makeContact('x')];

    await savePinHash(oldPin);
    await saveIdentityKeys(keys, oldKey);
    await saveContacts(contacts, oldKey);
    await saveChats([], oldKey);
    await saveRatchetSessions({}, oldKey);

    const newPin = '2222';
    const newKey = await changePin(oldPin, newPin);

    expect(newKey).toBeInstanceOf(Uint8Array);
    expect(newKey.length).toBe(32);

    // Data accessible with new key
    const loadedKeys = await loadIdentityKeys(newKey);
    expect(loadedKeys).not.toBeNull();
    expect(loadedKeys!.signing.publicKey).toBe(keys.signing.publicKey);

    const loadedContacts = await loadContacts(newKey);
    expect(loadedContacts).toEqual(contacts);

    // Old key should NOT work anymore (salt was regenerated)
    clearCachedMasterKey();
    const loadedWithOld = await loadIdentityKeys(oldKey);
    expect(loadedWithOld).toBeNull();
  });

  it('throws on wrong old PIN', async () => {
    const correctPin = '1111';
    const masterKey = await deriveMasterKeyFromPin(correctPin);
    const keys = generateIdentityKeys();

    await savePinHash(correctPin);
    await saveIdentityKeys(keys, masterKey);
    await saveContacts([], masterKey);
    await saveChats([], masterKey);
    await saveRatchetSessions({}, masterKey);

    clearCachedMasterKey();
    await expect(changePin('9999', '2222')).rejects.toThrow('Invalid current PIN');
  });
});

// ── panicWipe ────────────────────────────────────────────────────────────────

describe('panicWipe', () => {
  it('clears all stores', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const keys = generateIdentityKeys();

    await saveIdentityKeys(keys, masterKey);
    await saveContacts([makeContact('a')], masterKey);

    await panicWipe();

    // After wipe, nothing should be loadable
    clearCachedMasterKey();
    const newKey = await deriveMasterKeyFromPin('pin');
    const loaded = await loadIdentityKeys(newKey);
    // loaded should be null since identity was wiped
    expect(loaded).toBeNull();

    const account = await hasAccount();
    expect(account).toBe(false);
  });
});

// ── deleteKeys ───────────────────────────────────────────────────────────────

describe('deleteKeys', () => {
  it('deletes identity, sessions, prekeys, pin_hash but not settings/contacts', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const keys = generateIdentityKeys();

    await savePinHash('pin');
    await saveIdentityKeys(keys, masterKey);
    await saveContacts([makeContact('a')], masterKey);

    await deleteKeys();

    clearCachedMasterKey();
    const newKey = await deriveMasterKeyFromPin('pin');

    // Identity gone
    expect(await hasAccount()).toBe(false);

    // Contacts should still exist (deleteKeys only removes key material)
    const contacts = await loadContacts(newKey);
    expect(contacts.length).toBe(1);
  });
});

// ── deleteContact ────────────────────────────────────────────────────────────

describe('deleteContact', () => {
  it('removes a specific contact and its ratchet session', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    const contacts = [makeContact('a'), makeContact('b')];
    const sessions: RatchetSessions = {
      a: {
        dhSendingKeyPair: generateExchangeKeyPair(),
        dhReceivingPublicKey: null,
        rootKey: 'rk',
        sendingChainKey: null,
        receivingChainKey: null,
        sendingMessageNumber: 0,
        receivingMessageNumber: 0,
        previousSendingChainLength: 0,
        skippedMessageKeys: [],
      },
    };

    await saveContacts(contacts, masterKey);
    await saveRatchetSessions(sessions, masterKey);

    await deleteContact('a', masterKey);

    const loadedContacts = await loadContacts(masterKey);
    expect(loadedContacts.length).toBe(1);
    expect(loadedContacts[0]!.id).toBe('b');

    const loadedSessions = await loadRatchetSessions(masterKey);
    expect(loadedSessions['a']).toBeUndefined();
  });
});

// ── Hidden Chat PIN hashing ──────────────────────────────────────────────────

describe('hashHiddenChatPin / verifyHiddenChatPin', () => {
  it('hash then verify returns true for correct PIN', async () => {
    const pin = 'secret123';
    const hash = await hashHiddenChatPin(pin);
    const valid = await verifyHiddenChatPin(pin, hash);
    expect(valid).toBe(true);
  });

  it('verify returns false for wrong PIN', async () => {
    const hash = await hashHiddenChatPin('correct');
    const valid = await verifyHiddenChatPin('wrong', hash);
    expect(valid).toBe(false);
  });

  it('new format has 3 parts (salt:iterations:hash)', async () => {
    const hash = await hashHiddenChatPin('test');
    const parts = hash.split(':');
    expect(parts.length).toBe(3);
    expect(parseInt(parts[1]!, 10)).toBe(600_000);
  });

  it('isLegacyHiddenPinHash detects 2-part legacy format', () => {
    expect(isLegacyHiddenPinHash('salt:hash')).toBe(true);
    expect(isLegacyHiddenPinHash('salt:600000:hash')).toBe(false);
  });

  it('verifyHiddenChatPin rejects malformed hash', async () => {
    const valid = await verifyHiddenChatPin('pin', 'single_part_no_colons');
    expect(valid).toBe(false);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('empty contacts array roundtrip', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    await saveContacts([], masterKey);
    expect(await loadContacts(masterKey)).toEqual([]);
  });

  it('empty chats array roundtrip', async () => {
    const masterKey = await deriveMasterKeyFromPin('pin');
    await saveChats([], masterKey);
    expect(await loadChats(masterKey)).toEqual([]);
  });

  it('wrong masterKey returns null/empty for all data types', async () => {
    const correctKey = await deriveMasterKeyFromPin('correct');
    await saveIdentityKeys(generateIdentityKeys(), correctKey);
    await saveContacts([makeContact('a')], correctKey);
    await saveChats([makeChat('c1', 'a')], correctKey);

    // Create a fake wrong key
    const wrongKey = new Uint8Array(32);
    wrongKey.fill(42);

    expect(await loadIdentityKeys(wrongKey)).toBeNull();
    expect(await loadContacts(wrongKey)).toEqual([]);
    expect(await loadChats(wrongKey)).toEqual([]);
    expect(await loadRatchetSessions(wrongKey)).toEqual({});
  });
});
