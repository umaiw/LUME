'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { v4 as uuidv4 } from 'uuid';
import { authApi, messagesApi } from '@/lib/api';
import { wsClient } from '@/lib/websocket';
import { notifyIncomingMessage } from '@/lib/notifications';
import { useAuthStore, useContactsStore, useChatsStore, useSessionsStore, useUIStore } from '@/stores';
import {
  loadChats,
  loadContacts,
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

function reportCryptoIssue(message: string) {
  useUIStore.getState().setCryptoBanner({ level: 'warning', message });
}

const PREKEY_LOW_THRESHOLD = 10;
const PREKEY_REPLENISH_COUNT = 20;

/**
 * Проверяет количество оставшихся OPK и при необходимости генерирует и загружает новые.
 */
async function replenishPrekeys(
  pin: string,
  userId: string,
  identityKeys: import('@/crypto/keys').IdentityKeys
): Promise<void> {
  const material = await loadPreKeyMaterial(pin);
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
    console.warn('Failed to upload replenished prekeys:', error);
    return;
  }

  material.oneTimePreKeys.push(...newKeys);
  material.updatedAt = Date.now();
  await savePreKeyMaterial(material, pin);
}

async function ensureContact(params: {
  senderId: string;
  senderUsername: string;
  encryptedPayload: string;
  pin: string | null;
}): Promise<Contact | null> {
  const { senderId, senderUsername, encryptedPayload, pin } = params;

  const existing = useContactsStore.getState().contacts.find((c) => c.id === senderId);
  if (existing) return existing;

  let newContact: Contact | null = null;

  const { data } = await authApi.getUser(senderUsername);
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

  const latestContacts = useContactsStore.getState().contacts;
  if (!latestContacts.some((c) => c.id === newContact.id)) {
    useContactsStore.getState().addContact(newContact);
    if (pin) {
      await saveContacts([...latestContacts, newContact], pin);
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
  pin: string | null;
}): Promise<boolean> {
  const { senderId, senderUsername, messageId, encryptedPayload, fallbackTimestamp, pin } = params;

  const identityKeys = useAuthStore.getState().identityKeys;
  if (!identityKeys) return false;

  const ratchetEnvelope = parseRatchetEnvelope(encryptedPayload);

  const contactForMessage = await ensureContact({ senderId, senderUsername, encryptedPayload, pin });
  if (!contactForMessage) return false;

  let content = '[Unable to decrypt message]';
  let timestamp = fallbackTimestamp;
  let selfDestructSeconds: number | null | undefined = null;

  if (ratchetEnvelope) {
    // v2: X3DH + Double Ratchet (lume-ratchet)
    if (!pin) {
      reportCryptoIssue('Unlock to decrypt secure messages.');
      return false;
    }

    const sessions = useSessionsStore.getState().sessions;
    const existing = sessions[senderId];

    let session = existing ? deserializeSession(existing) : null;

    if (!session) {
      const x3dh = ratchetEnvelope.x3dh;
      if (!x3dh) {
        reportCryptoIssue('Secure session setup data missing (X3DH).');
        return false;
      }

      const material = await loadPreKeyMaterial(pin);
      if (!material) {
        reportCryptoIssue('Missing on-device keys. Restore access or recreate your account.');
        return false;
      }

      let opk: KeyPair | null = null;
      if (x3dh.recipientOneTimePreKey) {
        opk = await consumeOneTimePreKey(x3dh.recipientOneTimePreKey, pin);
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

  useChatsStore.getState().addMessage(targetChat.id, {
    id: messageId,
    chatId: targetChat.id,
    senderId,
    content,
    type: 'text',
    timestamp,
    status: 'delivered',
    selfDestructAt: selfDestructSeconds ? timestamp + selfDestructSeconds * 1000 : undefined,
  });

  return true;
}

export function useMessengerSync() {
  const router = useRouter();
  const { isAuthenticated, userId, pin, identityKeys, clearAuth } = useAuthStore();
  const setContacts = useContactsStore((s) => s.setContacts);
  const setChats = useChatsStore((s) => s.setChats);
  const setSessions = useSessionsStore((s) => s.setSessions);

  type PersistHydration = {
    persist?: {
      hasHydrated?: () => boolean;
    };
  };

  // Gate side-effects until auth store has finished rehydrating from storage.
  const hydrated = useSyncExternalStore(
    (onStoreChange) => useAuthStore.subscribe(() => onStoreChange()),
    () => (useAuthStore as unknown as PersistHydration).persist?.hasHydrated?.() ?? true,
    () => false
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
    if (!hydrated || !isAuthenticated || !userId || !identityKeys || !pin) return undefined;

    let isMounted = true;
    let saveChatsTimer: ReturnType<typeof setTimeout> | null = null;
    let saveContactsTimer: ReturnType<typeof setTimeout> | null = null;
    let saveSessionsTimer: ReturnType<typeof setTimeout> | null = null;

    const loadLocalContacts = async () => {
      const loaded = await loadContacts(pin);
      if (isMounted) setContacts(loaded);
    };

    const loadLocalChats = async () => {
      const loaded = await loadChats(pin);
      if (isMounted) setChats(loaded);
    };

    const loadLocalSessions = async () => {
      const loaded = await loadRatchetSessions(pin);
      if (isMounted) setSessions(loaded);
    };

    const scheduleChatsPersist = () => {
      if (saveChatsTimer) {
        clearTimeout(saveChatsTimer);
      }
      saveChatsTimer = setTimeout(() => {
        saveChatsTimer = null;
        const latestChats = useChatsStore.getState().chats;
        saveChats(latestChats, pin).catch(console.error);
      }, 600);
    };

    const scheduleContactsPersist = () => {
      if (saveContactsTimer) {
        clearTimeout(saveContactsTimer);
      }
      saveContactsTimer = setTimeout(() => {
        saveContactsTimer = null;
        const latestContacts = useContactsStore.getState().contacts;
        saveContacts(latestContacts, pin).catch(console.error);
      }, 600);
    };

    const scheduleSessionsPersist = () => {
      if (saveSessionsTimer) {
        clearTimeout(saveSessionsTimer);
      }
      saveSessionsTimer = setTimeout(() => {
        saveSessionsTimer = null;
        const latestSessions = useSessionsStore.getState().sessions;
        saveRatchetSessions(latestSessions, pin).catch(console.error);
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
        const processed = await appendIncomingMessage({
          senderId: pending.senderId,
          senderUsername: pending.senderUsername,
          messageId: pending.id,
          encryptedPayload: pending.encryptedPayload,
          fallbackTimestamp: pending.timestamp,
          pin,
        });
        if (processed) ackIds.push(pending.id);
      }

      if (ackIds.length > 0) {
        await messagesApi.acknowledgeBatch(ackIds, identityKeys);
      }

      // Replenish OPKs if running low after consuming during X3DH handshakes
      if (pin) {
        replenishPrekeys(pin, userId, identityKeys).catch(console.error);
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
      if (saveChatsTimer) {
        clearTimeout(saveChatsTimer);
        saveChatsTimer = null;
      }
      if (saveContactsTimer) {
        clearTimeout(saveContactsTimer);
        saveContactsTimer = null;
      }
      if (saveSessionsTimer) {
        clearTimeout(saveSessionsTimer);
        saveSessionsTimer = null;
      }
    };
  }, [hydrated, isAuthenticated, userId, pin, identityKeys, setContacts, setChats, setSessions, clearAuth, router]);

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
        const processed = await appendIncomingMessage({
          senderId: data.senderId,
          senderUsername: data.senderUsername,
          messageId: data.messageId,
          encryptedPayload: data.encryptedPayload,
          fallbackTimestamp: data.timestamp,
          pin: useAuthStore.getState().pin,
        });

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
            notifyIncomingMessage(data.senderUsername);
          }

          // Replenish OPKs after consuming during X3DH handshakes
          const currentPin = useAuthStore.getState().pin;
          const currentUserId = useAuthStore.getState().userId;
          if (currentPin && currentUserId) {
            replenishPrekeys(currentPin, currentUserId, identityKeys).catch(console.error);
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

      const chats = useChatsStore.getState().chats;
      for (const chat of chats) {
        for (const msgId of data.messageIds) {
          const msg = chat.messages.find((m) => m.id === msgId);
          if (msg && msg.status !== 'read') {
            useChatsStore.getState().updateMessage(chat.id, msgId, { status: 'read' });
          }
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




