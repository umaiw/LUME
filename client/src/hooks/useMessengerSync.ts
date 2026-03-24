'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { authApi, messagesApi } from '@/lib/api';
import { wsClient } from '@/lib/websocket';
import { notifyIncomingMessage } from '@/lib/notifications';
import { playMessageSound, initSoundPreference } from '@/lib/sounds';
import { reconcileSettingsConsistency } from '@/lib/settingsConsistency';
import { useAuthStore, useContactsStore, useChatsStore, useSessionsStore, useUIStore, useBlockedStore, type MessageAttachment } from '@/stores';
import {
  loadChats,
  loadContacts,
  loadSettings,
  loadPreKeyMaterial,
  loadRatchetSessions,
  saveChats,
  saveContacts,
  savePreKeyMaterial,
  saveRatchetSessions,
  consumeOneTimePreKey,
  type Contact,
  hasAccount,
} from '@/crypto/storage';
import { decodeMessagePayload, getSenderExchangeKeyFromPayload } from '@/lib/messagePayload';
import { parseRatchetEnvelope } from '@/lib/ratchetPayload';
import {
  deserializeSession,
  initReceiverSession,
  ratchetDecrypt,
  serializeSession,
  x3dhRespond,
  type EncryptedMessage,
} from '@/crypto/ratchet';
import { generateExchangeKeyPair, type KeyPair } from '@/crypto/keys';
import { checkAndRotateSpk } from '@/crypto/spkRotation';

function reportCryptoIssue(message: string) {
  useUIStore.getState().setCryptoBanner({ level: 'warning', message });
}

// Per-sender lock to prevent concurrent ratchet session mutations
const senderLocks = new Map<string, Promise<unknown>>();
function withSenderLock<T>(senderId: string, fn: () => Promise<T>): Promise<T> {
  const prev = senderLocks.get(senderId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  senderLocks.set(senderId, next);
  next.finally(() => {
    if (senderLocks.get(senderId) === next) {
      senderLocks.delete(senderId);
    }
  });
  return next;
}

function loadBlockedIds(): string[] {
  try {
    const raw = localStorage.getItem('lume:blocked');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch { /* ignore */ }
  return [];
}

function saveBlockedIds(): void {
  try {
    const ids = Object.keys(useBlockedStore.getState().blockedIds);
    localStorage.setItem('lume:blocked', JSON.stringify(ids));
  } catch { /* ignore */ }
}

const PREKEY_LOW_THRESHOLD = 10;
const PREKEY_REPLENISH_COUNT = 20;

/**
 * Проверяет количество оставшихся OPK и при необходимости генерирует и загружает новые.
 */
async function replenishPrekeys(
  masterKey: Uint8Array,
  userId: string,
  identityKeys: import('@/crypto/keys').IdentityKeys
): Promise<void> {
  const material = await loadPreKeyMaterial(masterKey);
  if (!material) return;

  if (material.oneTimePreKeys.length >= PREKEY_LOW_THRESHOLD) return;

  const newKeys: KeyPair[] = [];
  for (let i = 0; i < PREKEY_REPLENISH_COUNT; i++) {
    newKeys.push(generateExchangeKeyPair());
  }

  const uploadPayload = newKeys.map((k, i) => ({
    id: `${userId}-replenish-${Date.now()}-${i}`,
    publicKey: k.publicKey,
  }));

  const { error } = await authApi.uploadPrekeys(userId, uploadPayload, identityKeys);
  if (error) {
    if (process.env.NODE_ENV !== 'production') console.warn('Failed to upload replenished prekeys, skipping local save:', error);
    return;
  }

  material.oneTimePreKeys.push(...newKeys);
  material.updatedAt = Date.now();
  await savePreKeyMaterial(material, masterKey);
}

async function ensureContact(params: {
  senderId: string;
  senderUsername: string;
  encryptedPayload: string;
  masterKey: Uint8Array | null;
}): Promise<Contact | null> {
  const { senderId, senderUsername, encryptedPayload, masterKey } = params;

  const existing = useContactsStore.getState().contacts.find((c) => c.id === senderId);
  if (existing) return existing;

  let newContact: Contact | null = null;

  const identityKeys = useAuthStore.getState().identityKeys;
  const { data } = identityKeys
    ? await authApi.getUser(senderUsername, identityKeys)
    : { data: null };
  if (data && data.id === senderId) {
    newContact = {
      id: data.id,
      username: data.username,
      publicKey: data.identityKey,
      exchangeKey: data.exchangeIdentityKey || data.exchangeKey || data.signedPrekey,
      addedAt: Date.now(),
    };
  } else {
    const senderExchangeKey = getSenderExchangeKeyFromPayload(encryptedPayload);
    if (!senderExchangeKey) return null;

    newContact = {
      id: senderId,
      username: senderUsername,
      publicKey: '',
      exchangeKey: senderExchangeKey,
      addedAt: Date.now(),
    };
  }

  const currentContacts = useContactsStore.getState().contacts;
  if (!currentContacts.some((c) => c.id === newContact.id)) {
    useContactsStore.getState().addContact(newContact);
    const updatedContacts = useContactsStore.getState().contacts;
    if (masterKey) {
      await saveContacts(updatedContacts, masterKey);
    }
  }

  return newContact;
}

async function appendIncomingMessage(params: {
  senderId: string;
  senderUsername: string;
  messageId: string;
  encryptedPayload: string;
  fallbackTimestamp: number;
  masterKey: Uint8Array | null;
}): Promise<boolean> {
  const { senderId, senderUsername, messageId, encryptedPayload, fallbackTimestamp, masterKey } = params;

  const identityKeys = useAuthStore.getState().identityKeys;
  if (!identityKeys) return false;

  const isBlockedSender = !!useBlockedStore.getState().blockedIds[senderId];

  const ratchetEnvelope = parseRatchetEnvelope(encryptedPayload);

  const contactForMessage = await ensureContact({ senderId, senderUsername, encryptedPayload, masterKey });
  if (!contactForMessage) return false;

  let content = '[Unable to decrypt message]';
  let timestamp = fallbackTimestamp;
  let selfDestructSeconds: number | null | undefined = null;
  let replyTo: { messageId: string; content: string; senderId: string } | undefined;
  let attachment: MessageAttachment | undefined;

  if (ratchetEnvelope) {
    // v2: X3DH + Double Ratchet (lume-ratchet)
    if (!masterKey) {
      reportCryptoIssue('Unlock to decrypt secure messages.');
      return false;
    }

    // Read fresh session state inside the lock to prevent race conditions
    const freshSessions = useSessionsStore.getState().sessions;
    const existing = freshSessions[senderId];

    let session = existing ? deserializeSession(existing) : null;

    if (!session) {
      const x3dh = ratchetEnvelope.x3dh;
      if (!x3dh) {
        reportCryptoIssue('Secure session setup data missing (X3DH).');
        return false;
      }

      const material = await loadPreKeyMaterial(masterKey);
      if (!material) {
        reportCryptoIssue('Missing on-device keys. Restore access or recreate your account.');
        return false;
      }

      let opk: KeyPair | null = null;
      if (x3dh.recipientOneTimePreKey) {
        opk = await consumeOneTimePreKey(x3dh.recipientOneTimePreKey, masterKey);
        if (!opk) {
          reportCryptoIssue('One-time prekey missing. Ask your contact to retry.');
          return false;
        }
      }

      const sharedSecret = x3dhRespond(
        identityKeys.exchange,
        material.signedPreKey,
        opk,
        x3dh.senderIdentityKey,
        x3dh.senderEphemeralKey
      );
      session = initReceiverSession(sharedSecret, material.signedPreKey);
    }

    const encrypted: EncryptedMessage = {
      header: ratchetEnvelope.header,
      ciphertext: ratchetEnvelope.ciphertext,
      nonce: ratchetEnvelope.nonce,
    };

    let plaintextBytes: Uint8Array | null = null;
    try {
      plaintextBytes = ratchetDecrypt(session, encrypted);
    } catch {
      reportCryptoIssue('Secure message decrypt failed. Session may be out of sync.');
      return false;
    }

    if (!plaintextBytes) {
      reportCryptoIssue('Secure message decrypt failed. Session may be out of sync.');
      return false;
    }

    try {
      const decoded = JSON.parse(new TextDecoder().decode(plaintextBytes)) as {
        content?: unknown;
        timestamp?: unknown;
        selfDestruct?: unknown;
        replyTo?: unknown;
        attachment?: unknown;
      };
      if (typeof decoded.content === 'string') {
        content = decoded.content;
      }
      if (typeof decoded.timestamp === 'number') {
        timestamp = decoded.timestamp;
      } else {
        timestamp = ratchetEnvelope.timestamp ?? fallbackTimestamp;
      }
      if (typeof decoded.selfDestruct === 'number' || decoded.selfDestruct === null) {
        selfDestructSeconds = decoded.selfDestruct as number | null;
      } else {
        selfDestructSeconds = ratchetEnvelope.selfDestruct ?? null;
      }
      // Parse reply reference
      if (decoded.replyTo && typeof decoded.replyTo === 'object') {
        const rt = decoded.replyTo as Record<string, unknown>;
        if (typeof rt.messageId === 'string' && typeof rt.content === 'string' && typeof rt.senderId === 'string') {
          replyTo = { messageId: rt.messageId, content: rt.content, senderId: rt.senderId };
        }
      }
      // Parse attachment metadata
      if (decoded.attachment && typeof decoded.attachment === 'object') {
        const att = decoded.attachment as Record<string, unknown>;
        if (
          typeof att.fileId === 'string' &&
          typeof att.fileName === 'string' &&
          typeof att.mimeType === 'string' &&
          typeof att.size === 'number' &&
          typeof att.key === 'string' &&
          typeof att.nonce === 'string'
        ) {
          attachment = {
            fileId: att.fileId,
            fileName: att.fileName,
            mimeType: att.mimeType,
            size: att.size,
            key: att.key,
            nonce: att.nonce,
          };
        }
      }
    } catch {
      timestamp = ratchetEnvelope.timestamp ?? fallbackTimestamp;
      selfDestructSeconds = ratchetEnvelope.selfDestruct ?? null;
    }

    useSessionsStore.getState().upsertSession(senderId, serializeSession(session));
    useUIStore.getState().clearCryptoBanner();
  } else {
    // v1: nacl.box (legacy)
    const senderExchangeKey =
      contactForMessage.exchangeKey || getSenderExchangeKeyFromPayload(encryptedPayload) || undefined;

    const decoded = decodeMessagePayload(
      encryptedPayload,
      identityKeys.exchange.secretKey,
      senderExchangeKey
    );
    if (decoded?.content) {
      content = decoded.content;
    }
    timestamp = decoded?.timestamp ?? fallbackTimestamp;
    selfDestructSeconds = decoded?.selfDestruct ?? null;
  }

  // Blocked contacts: ratchet was advanced above to stay in sync,
  // but we silently discard the message (no chat entry, no notification).
  if (isBlockedSender) return true;

  const allChats = useChatsStore.getState().chats;
  let targetChat = allChats.find((c) => c.contactId === senderId);
  if (!targetChat) {
    const newChatId = uuidv4();
    useChatsStore.getState().addChat({
      id: newChatId,
      contactId: senderId,
      messages: [],
      unreadCount: 0,
      isHidden: false,
    });
    targetChat = {
      id: newChatId,
      contactId: senderId,
      messages: [],
      unreadCount: 0,
      isHidden: false,
    };
  }

  const msgType = attachment
    ? (attachment.mimeType.startsWith('image/') ? 'image' : 'file')
    : 'text';

  useChatsStore.getState().addMessage(targetChat.id, {
    id: messageId,
    chatId: targetChat.id,
    senderId,
    content,
    type: msgType,
    timestamp,
    status: 'delivered',
    selfDestructAt: selfDestructSeconds ? timestamp + selfDestructSeconds * 1000 : undefined,
    replyTo,
    attachment,
  });

  return true;
}

export function useMessengerSync() {
  const router = useRouter();
  const { isAuthenticated, userId, masterKey, identityKeys, clearAuth } = useAuthStore();
  const setContacts = useContactsStore((s) => s.setContacts);
  const setChats = useChatsStore((s) => s.setChats);
  const setSessions = useSessionsStore((s) => s.setSessions);

  type PersistHydration = {
    persist?: {
      hasHydrated?: () => boolean;
    };
  };

  // Gate side-effects until auth store has finished rehydrating from storage.
  // Both snapshots use the same fallback so SSR and client agree when persist is absent.
  const hydrated = useSyncExternalStore(
    (onStoreChange) => useAuthStore.subscribe(() => onStoreChange()),
    () => (useAuthStore as unknown as PersistHydration).persist?.hasHydrated?.() ?? true,
    () => (useAuthStore as unknown as PersistHydration).persist?.hasHydrated?.() ?? true
  );

  useEffect(() => {
    if (!hydrated || isAuthenticated) return;

    let active = true;
    wsClient.disconnect();

    (async () => {
      const exists = await hasAccount();
      if (!active) return;
      router.push(exists ? '/unlock' : '/');
    })();

    return () => {
      active = false;
    };
  }, [hydrated, isAuthenticated, router]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !userId || !identityKeys || !masterKey) return undefined;

    let isMounted = true;
    let saveChatsTimer: ReturnType<typeof setTimeout> | null = null;
    let saveContactsTimer: ReturnType<typeof setTimeout> | null = null;
    let saveSessionsTimer: ReturnType<typeof setTimeout> | null = null;

    const loadLocalContacts = async () => {
      const loaded = await loadContacts(masterKey);
      if (isMounted) setContacts(loaded);
    };

    const loadLocalChats = async () => {
      const loaded = await loadChats(masterKey);
      if (!isMounted) return;

      let nextChats = loaded;
      let nextShowHiddenChats = useUIStore.getState().showHiddenChats;

      const settings = await loadSettings(masterKey).catch(() => null);
      if (settings) {
        const consistency = reconcileSettingsConsistency({
          settings,
          chats: loaded,
          showHiddenChats: nextShowHiddenChats,
        });
        nextChats = consistency.chats;
        nextShowHiddenChats = consistency.showHiddenChats;

        if (
          process.env.NODE_ENV !== 'production' &&
          consistency.issues.length > 0
        ) {
          console.warn('[settings-consistency]', consistency.issues.join(' | '));
        }
      }

      setChats(nextChats);
      useUIStore.getState().setShowHiddenChats(nextShowHiddenChats);
    };

    const loadLocalSessions = async () => {
      const loaded = await loadRatchetSessions(masterKey);
      if (isMounted) setSessions(loaded);
    };

    const scheduleChatsPersist = () => {
      if (saveChatsTimer) {
        clearTimeout(saveChatsTimer);
      }
      saveChatsTimer = setTimeout(() => {
        saveChatsTimer = null;
        const latestChats = useChatsStore.getState().chats;
        saveChats(latestChats, masterKey).catch(console.error);
      }, 600);
    };

    const scheduleContactsPersist = () => {
      if (saveContactsTimer) {
        clearTimeout(saveContactsTimer);
      }
      saveContactsTimer = setTimeout(() => {
        saveContactsTimer = null;
        const latestContacts = useContactsStore.getState().contacts;
        saveContacts(latestContacts, masterKey).catch(console.error);
      }, 600);
    };

    const scheduleSessionsPersist = () => {
      if (saveSessionsTimer) {
        clearTimeout(saveSessionsTimer);
      }
      saveSessionsTimer = setTimeout(() => {
        saveSessionsTimer = null;
        const latestSessions = useSessionsStore.getState().sessions;
        saveRatchetSessions(latestSessions, masterKey).catch(console.error);
      }, 600);
    };

    const unsubscribeChats = useChatsStore.subscribe((state, prev) => {
      if (state.chats !== prev.chats) {
        scheduleChatsPersist();
      }
    });

    const unsubscribeContacts = useContactsStore.subscribe((state, prev) => {
      if (state.contacts !== prev.contacts) {
        scheduleContactsPersist();
      }
    });

    const unsubscribeSessions = useSessionsStore.subscribe((state, prev) => {
      if (state.sessions !== prev.sessions) {
        scheduleSessionsPersist();
      }
    });

    const syncPendingMessages = async () => {
      if (!identityKeys || !userId) return;

      const { data, error } = await messagesApi.getPending(userId, identityKeys);
      if (error || !data) return;

      const ackIds: string[] = [];
      for (const pending of data.messages) {
        const processed = await withSenderLock(pending.senderId, () =>
          appendIncomingMessage({
            senderId: pending.senderId,
            senderUsername: pending.senderUsername,
            messageId: pending.id,
            encryptedPayload: pending.encryptedPayload,
            fallbackTimestamp: pending.timestamp,
            masterKey,
          })
        );
        if (processed) ackIds.push(pending.id);
      }

      if (ackIds.length > 0) {
        await messagesApi.acknowledgeBatch(ackIds, identityKeys);
      }

      // Replenish OPKs if running low after consuming during X3DH handshakes
      if (masterKey) {
        replenishPrekeys(masterKey, userId, identityKeys).catch(console.error);
        // Check SPK age and rotate if needed (periodic check on sync)
        checkAndRotateSpk(masterKey, userId, identityKeys).catch(console.error);
      }
    };

    const connectWs = async (retryCount = 0) => {
      if (!isMounted) return;

      try {
        const { data, error } = await authApi.getSession(userId, identityKeys);
        if (!isMounted) return;

        if (error || !data) {
          if (error === 'User not found') {
            clearAuth();
            router.push('/');
            return;
          }

          // Retry a few times for rate limits / transient network errors.
          if (retryCount < 3) {
            const delay = 1000 * Math.pow(2, retryCount);
            setTimeout(() => void connectWs(retryCount + 1), delay);
          }
          return;
        }

        wsClient.connect(data.token).catch(console.error);
        syncPendingMessages().catch(console.error);
      } catch {
        if (retryCount < 3) {
          setTimeout(() => void connectWs(retryCount + 1), 1000);
        }
      }
    };

    void loadLocalContacts();
    void loadLocalChats();
    void loadLocalSessions();
    void connectWs();
    initSoundPreference();
    void (async () => {
      const localBlocked = loadBlockedIds();
      useBlockedStore.getState().setBlockedIds(localBlocked);

      const { data } = await authApi.getBlockedUsers(identityKeys);
      if (!data || !Array.isArray(data.blockedIds)) return;

      const merged = [...new Set([...localBlocked, ...data.blockedIds])];
      useBlockedStore.getState().setBlockedIds(merged);
    })();

    // Persist blocked IDs on change
    const unsubscribeBlocked = useBlockedStore.subscribe((state, prev) => {
      if (state.blockedIds !== prev.blockedIds) {
        saveBlockedIds();
      }
    });

    wsClient.setTokenExpireHandler(async () => {
      try {
        const { data } = await authApi.getSession(userId, identityKeys);
        if (data) {
          wsClient.connect(data.token).catch(console.error);
          syncPendingMessages().catch(console.error);
        }
      } catch (e) {
        console.error('Token refresh error:', e);
      }
    });

    return () => {
      isMounted = false;
      unsubscribeChats();
      unsubscribeContacts();
      unsubscribeSessions();
      unsubscribeBlocked();

      // Flush any pending debounced writes before unmounting
      if (saveChatsTimer) {
        clearTimeout(saveChatsTimer);
        saveChatsTimer = null;
        saveChats(useChatsStore.getState().chats, masterKey).catch(console.error);
      }
      if (saveContactsTimer) {
        clearTimeout(saveContactsTimer);
        saveContactsTimer = null;
        saveContacts(useContactsStore.getState().contacts, masterKey).catch(console.error);
      }
      if (saveSessionsTimer) {
        clearTimeout(saveSessionsTimer);
        saveSessionsTimer = null;
        saveRatchetSessions(useSessionsStore.getState().sessions, masterKey).catch(console.error);
      }
    };
  }, [hydrated, isAuthenticated, userId, masterKey, identityKeys, setContacts, setChats, setSessions, clearAuth, router]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || !identityKeys) return undefined;

    const handleNewMessage = (rawData: unknown) => {
      const data = rawData as {
        senderId: string;
        senderUsername: string;
        encryptedPayload: string;
        messageId: string;
        timestamp: number;
      };

      void (async () => {
        const processed = await withSenderLock(data.senderId, () =>
          appendIncomingMessage({
            senderId: data.senderId,
            senderUsername: data.senderUsername,
            messageId: data.messageId,
            encryptedPayload: data.encryptedPayload,
            fallbackTimestamp: data.timestamp,
            masterKey: useAuthStore.getState().masterKey,
          })
        );

        if (processed) {
          await messagesApi.acknowledge(data.messageId, identityKeys);

          // If the chat is currently active, send a read receipt immediately
          const activeChat = useChatsStore.getState().activeChatId;
          const chatsNow = useChatsStore.getState().chats;
          const activeContactChat = chatsNow.find((c) => c.id === activeChat);
          if (activeContactChat && activeContactChat.contactId === data.senderId) {
            wsClient.sendReadReceipt(data.senderId, [data.messageId]);
          } else {
            // Notify if the chat is not currently active
            const settings = await loadSettings().catch(() => null);
            if (!settings || settings.notifications) {
              notifyIncomingMessage(data.senderUsername);
            }
            playMessageSound();
          }

          // Replenish OPKs after consuming during X3DH handshakes
          const currentMasterKey = useAuthStore.getState().masterKey;
          const currentUserId = useAuthStore.getState().userId;
          if (currentMasterKey && currentUserId) {
            replenishPrekeys(currentMasterKey, currentUserId, identityKeys).catch(console.error);
          }
        }
      })();
    };

    wsClient.on('new_message', handleNewMessage);
    return () => {
      wsClient.off('new_message', handleNewMessage);
    };
  }, [hydrated, isAuthenticated, identityKeys]);

  // Handle incoming read receipts — update message status for our sent messages
  useEffect(() => {
    if (!hydrated || !isAuthenticated) return undefined;

    const handleReadReceipt = (rawData: unknown) => {
      const data = rawData as {
        senderId: string;
        messageIds: string[];
      };

      const msgIdSet = new Set(data.messageIds);
      const chats = useChatsStore.getState().chats;

      // The read receipt sender is the contact — find their chat directly
      const chat = chats.find((c) => c.contactId === data.senderId);
      if (!chat) return;

      for (const msg of chat.messages) {
        if (msgIdSet.has(msg.id) && msg.status !== 'read') {
          useChatsStore.getState().updateMessage(chat.id, msg.id, { status: 'read' });
        }
      }
    };

    wsClient.on('read', handleReadReceipt);
    return () => {
      wsClient.off('read', handleReadReceipt);
    };
  }, [hydrated, isAuthenticated]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated) return undefined;

    const interval = setInterval(() => {
      const now = Date.now();
      const chats = useChatsStore.getState().chats;
      const hasExpired = chats.some((chat) => chat.messages.some((msg) => msg.selfDestructAt && msg.selfDestructAt <= now));
      if (hasExpired) {
        useChatsStore.getState().pruneExpiredMessages(now);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [hydrated, isAuthenticated]);

  return { hydrated };
}


