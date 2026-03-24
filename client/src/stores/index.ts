/**
 * Глобальное состояние приложения
 * Zustand store для управления аутентификацией, контактами, чатами
 */

import { create } from 'zustand';
import type { IdentityKeys } from '@/crypto/keys';
import type { Contact } from '@/crypto/storage';
import { clearCachedMasterKey } from '@/crypto/storage';
import type { SerializedSession } from '@/crypto/ratchet';

// ==================== Auth Store ====================

interface AuthState {
    isAuthenticated: boolean;
    userId: string | null;
    username: string | null;
    identityKeys: IdentityKeys | null;
    /** Derived encryption key — never the raw PIN. */
    masterKey: Uint8Array | null;

    // Actions
    setAuth: (userId: string, username: string, keys: IdentityKeys, masterKey: Uint8Array) => void;
    clearAuth: () => void;
    setMasterKey: (key: Uint8Array) => void;
}

// SECURITY: Never persist secret keys in web storage. Keep them in-memory only.
// The raw PIN is never stored — only the derived master key lives here temporarily.
export const useAuthStore = create<AuthState>((set, get) => ({
    isAuthenticated: false,
    userId: null,
    username: null,
    identityKeys: null,
    masterKey: null,

    setAuth: (userId, username, identityKeys, masterKey) =>
        set({ isAuthenticated: true, userId, username, identityKeys, masterKey }),

    clearAuth: () => {
        // Zero out key material before releasing the reference
        const currentKey = get().masterKey;
        if (currentKey) {
            currentKey.fill(0);
        }
        clearCachedMasterKey();
        set({
            isAuthenticated: false,
            userId: null,
            username: null,
            identityKeys: null,
            masterKey: null,
        });
    },

    setMasterKey: (key) => set({ masterKey: key }),
}));

// ==================== Contacts Store ====================

interface ContactsState {
    contacts: Contact[];

    // Actions
    setContacts: (contacts: Contact[]) => void;
    addContact: (contact: Contact) => void;
    removeContact: (id: string) => void;
    updateContact: (id: string, updates: Partial<Contact>) => void;
}

export const useContactsStore = create<ContactsState>()((set) => ({
    contacts: [],

    setContacts: (contacts) => set({ contacts }),

    addContact: (contact) =>
        set((state) => ({ contacts: [...state.contacts, contact] })),

    removeContact: (id) =>
        set((state) => ({
            contacts: state.contacts.filter((c) => c.id !== id),
        })),

    updateContact: (id, updates) =>
        set((state) => ({
            contacts: state.contacts.map((c) =>
                c.id === id ? { ...c, ...updates } : c
            ),
        })),
}));

// ==================== Sessions Store (Double Ratchet) ====================

interface SessionsState {
    sessions: Record<string, SerializedSession>;

    setSessions: (sessions: Record<string, SerializedSession>) => void;
    upsertSession: (contactId: string, session: SerializedSession) => void;
    deleteSession: (contactId: string) => void;
}

export const useSessionsStore = create<SessionsState>()((set) => ({
    sessions: {},

    setSessions: (sessions) => set({ sessions }),

    upsertSession: (contactId, session) =>
        set((state) => ({
            sessions: { ...state.sessions, [contactId]: session },
        })),

    deleteSession: (contactId) =>
        set((state) => {
            if (!(contactId in state.sessions)) return state;
            const next = { ...state.sessions };
            delete next[contactId];
            return { sessions: next };
        }),
}));

// ==================== Chat Store ====================

export interface MessageReplyRef {
    messageId: string;
    content: string;
    senderId: string;
}

export interface MessageAttachment {
    fileId: string;
    fileName: string;
    mimeType: string;
    size: number;
    /** NaCl secretbox key (base64) — needed to decrypt the file */
    key: string;
    /** NaCl secretbox nonce (base64) */
    nonce: string;
}

export interface Message {
    id: string;
    chatId: string;
    senderId: string;
    content: string;
    type: 'text' | 'image' | 'video' | 'file' | 'voice';
    timestamp: number;
    status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
    selfDestructAt?: number;
    isDeleted?: boolean;
    replyTo?: MessageReplyRef;
    attachment?: MessageAttachment;
}

export interface Chat {
    id: string;
    contactId: string;
    messages: Message[];
    unreadCount: number;
    lastMessage?: Message;
    isHidden: boolean;
    selfDestructTimer?: number; // секунды
}

interface ChatsState {
    chats: Chat[];
    activeChatId: string | null;

    // Actions
    setChats: (chats: Chat[]) => void;
    setActiveChat: (chatId: string | null) => void;
    addChat: (chat: Chat) => void;
    addMessage: (chatId: string, message: Message) => void;
    updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
    markAsRead: (chatId: string) => void;
    deleteMessage: (chatId: string, messageId: string) => void;
    deleteChat: (chatId: string) => void;
    setChatHidden: (chatId: string, hidden: boolean) => void;
    setSelfDestructTimer: (chatId: string, timer: number | undefined) => void;
    pruneExpiredMessages: (now?: number) => void;
}

const MAX_MESSAGES_PER_CHAT = 200;

export const useChatsStore = create<ChatsState>()(
    (set, get) => ({
        chats: [],
        activeChatId: null,

        setChats: (chats) => set({ chats }),

        setActiveChat: (chatId) => set({ activeChatId: chatId }),

        addChat: (chat) =>
            set((state) => ({ chats: [...state.chats, chat] })),

        addMessage: (chatId, message) =>
            set((state) => ({
                chats: state.chats.map((chat) =>
                    chat.id !== chatId
                        ? chat
                        : (() => {
                            if (chat.messages.some((existing) => existing.id === message.id)) {
                                return chat;
                            }

                            const isActiveChat = get().activeChatId === chatId;
                            return {
                                ...chat,
                                messages: [...chat.messages, message].slice(-MAX_MESSAGES_PER_CHAT),
                                lastMessage: message,
                                unreadCount: isActiveChat ? chat.unreadCount : chat.unreadCount + 1,
                            };
                        })()
                ),
            })),

        updateMessage: (chatId, messageId, updates) =>
            set((state) => ({
                chats: state.chats.map((chat) =>
                    chat.id !== chatId
                        ? chat
                        : (() => {
                            const messages = chat.messages.map((msg) =>
                                msg.id === messageId ? { ...msg, ...updates } : msg
                            );
                            const lastMessage = chat.lastMessage?.id === messageId
                                ? { ...chat.lastMessage, ...updates }
                                : chat.lastMessage;
                            return { ...chat, messages, lastMessage };
                        })()
                ),
            })),

        markAsRead: (chatId) =>
            set((state) => {
                const target = state.chats.find((c) => c.id === chatId);
                if (!target || target.unreadCount === 0) return state;
                return {
                    chats: state.chats.map((chat) =>
                        chat.id === chatId ? { ...chat, unreadCount: 0 } : chat
                    ),
                };
            }),

        deleteMessage: (chatId, messageId) =>
            set((state) => ({
                chats: state.chats.map((chat) =>
                    chat.id !== chatId
                        ? chat
                        : (() => {
                            const messages = chat.messages.filter((msg) => msg.id !== messageId);
                            const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
                            return { ...chat, messages, lastMessage };
                        })()
                ),
            })),

        deleteChat: (chatId) =>
            set((state) => ({
                chats: state.chats.filter((chat) => chat.id !== chatId),
                activeChatId:
                    state.activeChatId === chatId ? null : state.activeChatId,
            })),

        setChatHidden: (chatId, hidden) =>
            set((state) => ({
                chats: state.chats.map((chat) =>
                    chat.id === chatId ? { ...chat, isHidden: hidden } : chat
                ),
            })),

        setSelfDestructTimer: (chatId, timer) =>
            set((state) => ({
                chats: state.chats.map((chat) =>
                    chat.id === chatId
                        ? { ...chat, selfDestructTimer: timer }
                        : chat
                ),
            })),

        pruneExpiredMessages: (now = Date.now()) =>
            set((state) => ({
                chats: state.chats.map((chat) => {
                    const nextMessages = chat.messages.filter(
                        (msg) => !msg.selfDestructAt || msg.selfDestructAt > now
                    );
                    if (nextMessages.length === chat.messages.length) {
                        return chat;
                    }
                    const lastMessage = nextMessages.length > 0 ? nextMessages[nextMessages.length - 1] : undefined;
                    return {
                        ...chat,
                        messages: nextMessages,
                        lastMessage,
                        unreadCount: Math.min(chat.unreadCount, nextMessages.length),
                    };
                }),
            })),
    })
);

// ==================== UI Store ====================

interface UIState {
    isPanicMode: boolean;
    showHiddenChats: boolean;
    isOnline: boolean;
    wsConnected: boolean;
    wsStatus: 'connected' | 'connecting' | 'disconnected' | 'rate_limited' | 'kicked' | 'auth_error';
    cryptoBanner: { level: 'info' | 'warning' | 'error'; message: string; updatedAt: number } | null;

    // Actions
    setPanicMode: (active: boolean) => void;
    setShowHiddenChats: (show: boolean) => void;
    setOnline: (online: boolean) => void;
    setWsConnected: (connected: boolean) => void;
    setWsStatus: (status: UIState['wsStatus']) => void;
    setCryptoBanner: (banner: { level: 'info' | 'warning' | 'error'; message: string }) => void;
    clearCryptoBanner: () => void;
}

export const useUIStore = create<UIState>()((set) => ({
    isPanicMode: false,
    showHiddenChats: false,
    isOnline: true,
    wsConnected: false,
    wsStatus: 'disconnected',
    cryptoBanner: null,

    setPanicMode: (active) => set({ isPanicMode: active }),
    setShowHiddenChats: (show) => set({ showHiddenChats: show }),
    setOnline: (online) => set({ isOnline: online }),
    setWsConnected: (connected) => set({ wsConnected: connected, wsStatus: connected ? 'connected' : 'disconnected' }),
    setWsStatus: (status) => set({ wsStatus: status, wsConnected: status === 'connected' }),
    setCryptoBanner: (banner) =>
        set((state) => {
            const now = Date.now();
            // Prevent UI thrash if a loop repeatedly reports the same crypto issue.
            if (state.cryptoBanner?.message === banner.message && now - state.cryptoBanner.updatedAt < 10000) {
                return state;
            }
            return { cryptoBanner: { ...banner, updatedAt: now } };
        }),
    clearCryptoBanner: () => set({ cryptoBanner: null }),
}));

// ==================== Typing Store ====================

interface TypingState {
    /** contactId -> true if currently typing */
    typingUsers: Record<string, boolean>;

    setTyping: (contactId: string, isTyping: boolean) => void;
    clearAll: () => void;
}

export const useTypingStore = create<TypingState>()((set) => ({
    typingUsers: {},

    setTyping: (contactId, isTyping) =>
        set((state) => {
            if (isTyping) {
                return { typingUsers: { ...state.typingUsers, [contactId]: true } };
            }
            if (!(contactId in state.typingUsers)) return state;
            const next = { ...state.typingUsers };
            delete next[contactId];
            return { typingUsers: next };
        }),

    clearAll: () => set({ typingUsers: {} }),
}));

// ==================== Blocked Store ====================

interface BlockedState {
    /** Map of blocked contact IDs → true */
    blockedIds: Record<string, true>;

    setBlockedIds: (ids: string[]) => void;
    addBlocked: (id: string) => void;
    removeBlocked: (id: string) => void;
    isBlocked: (id: string) => boolean;
}

export const useBlockedStore = create<BlockedState>()((set, get) => ({
    blockedIds: {},

    setBlockedIds: (ids) => {
        const map: Record<string, true> = {};
        for (const id of ids) map[id] = true;
        set({ blockedIds: map });
    },

    addBlocked: (id) =>
        set((state) => {
            if (state.blockedIds[id]) return state;
            return { blockedIds: { ...state.blockedIds, [id]: true } };
        }),

    removeBlocked: (id) =>
        set((state) => {
            if (!state.blockedIds[id]) return state;
            const next = { ...state.blockedIds };
            delete next[id];
            return { blockedIds: next };
        }),

    isBlocked: (id) => !!get().blockedIds[id],
}));
