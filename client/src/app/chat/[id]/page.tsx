/**
 * Messenger: active chat view inside the dashboard shell (desktop).
 * Mobile shows chat only with a back button.
 */

"use client";

import { useEffect, useRef, useState, use, memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import MessengerShell from "@/components/messenger/MessengerShell";
import LeftRail from "@/components/messenger/LeftRail";
import ChatListPanel from "@/components/messenger/ChatListPanel";
import RightRail from "@/components/messenger/RightRail";
import { Button, Input, Modal, ChatListSkeleton, MessagesSkeleton } from "@/components/ui";
import { useMessengerSync } from "@/hooks/useMessengerSync";
import { useContactActions } from "@/hooks/useContactActions";
import { usePanic } from "@/hooks/usePanic";
import {
  useAuthStore,
  useContactsStore,
  useChatsStore,
  useSessionsStore,
  useUIStore,
  useTypingStore,
  type Message,
} from "@/stores";
import { authApi, messagesApi } from "@/lib/api";
import { wsClient } from "@/lib/websocket";
import { exportEncryptedBackup, importEncryptedBackup } from "@/crypto/storage";
import { decodeBase64 } from "tweetnacl-util";
import { verify } from "@/crypto/keys";
import { encodeRatchetEnvelope } from "@/lib/ratchetPayload";
import {
  deserializeSession,
  initSenderSession,
  ratchetEncrypt,
  serializeSession,
  x3dhInitiate,
} from "@/crypto/ratchet";
import { computeSafetyNumber } from "@/crypto/safetyNumber";

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  const base = "w-4 h-4";

  if (status === "sending") {
    return (
      <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin inline-block" />
    );
  }

  if (status === "failed") {
    return (
      <svg
        className={base}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M12 9v4"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M12 17h.01"
        />
      </svg>
    );
  }

  if (status === "sent") {
    return (
      <svg
        className={base}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M5 12l4 4L19 6"
        />
      </svg>
    );
  }

  if (status === "delivered" || status === "read") {
    return (
      <svg
        className={base}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M3 12l4 4L17 6"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M7 12l4 4L21 6"
        />
      </svg>
    );
  }

  return null;
}

function MessageBubble({
  message,
  isMine,
  onDelete,
}: {
  message: Message;
  isMine: boolean;
  onDelete: (messageId: string) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const timeLabel = new Date(message.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`group flex ${isMine ? "justify-end" : "justify-start"}`}>
      {/* Delete button — appears on hover (left of own messages) */}
      {isMine && (
        <button
          type="button"
          onClick={() => setShowActions(!showActions)}
          className="self-center mr-2 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-1"
          title="Delete message"
        >
          <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
      <div className="relative">
        <div
          className={`max-w-[78%] px-4 py-2.5 ${isMine ? "message-bubble-sent" : "message-bubble-received"}`}
        >
          <p className="break-words text-[15px] leading-relaxed">
            {message.content}
          </p>
          <div
            className={`flex items-center justify-end gap-1.5 mt-1 ${isMine ? "opacity-80" : "text-[var(--text-muted)]"}`}
          >
            <span className="text-[11px] uppercase tracking-[0.06em]">
              {timeLabel}
            </span>
            {isMine ? <StatusIcon status={message.status} /> : null}
            {message.selfDestructAt ? (
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 8v5l3 2"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            ) : null}
          </div>
        </div>

        {/* Inline delete confirmation */}
        {showActions && (
          <div className="absolute top-0 right-0 -mt-8 flex gap-1 z-10">
            <button
              type="button"
              onClick={() => {
                onDelete(message.id);
                setShowActions(false);
              }}
              className="px-2 py-1 text-[11px] uppercase tracking-[0.06em] font-semibold rounded-md bg-red-500/90 text-white hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setShowActions(false)}
              className="px-2 py-1 text-[11px] uppercase tracking-[0.06em] font-semibold rounded-md bg-[var(--surface-strong)] text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--surface)] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {/* Delete button — appears on hover (right of received messages) */}
      {!isMine && (
        <button
          type="button"
          onClick={() => setShowActions(!showActions)}
          className="self-center ml-2 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity p-1"
          title="Delete message"
        >
          <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
          </svg>
        </button>
      )}
    </div>
  );
}

const MessageBubbleMemo = memo(
  MessageBubble,
  (prev, next) =>
    prev.isMine === next.isMine &&
    prev.message.id === next.message.id &&
    prev.message.status === next.message.status &&
    prev.message.content === next.message.content &&
    prev.message.timestamp === next.message.timestamp &&
    prev.message.selfDestructAt === next.message.selfDestructAt &&
    prev.onDelete === next.onDelete,
);

export default function ChatPage({ params }: ChatPageProps) {
  const { id: chatId } = use(params);
  const router = useRouter();
  const { hydrated } = useMessengerSync();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStateRef = useRef(false);

  const { userId, identityKeys, pin } = useAuthStore();
  const { contacts, removeContact } = useContactsStore();
  const { upsertSession, deleteSession } = useSessionsStore();
  const {
    chats,
    addMessage,
    updateMessage,
    deleteMessage,
    deleteChat,
    markAsRead,
    setSelfDestructTimer,
    activeChatId,
    setActiveChat,
  } = useChatsStore();
  const { setCryptoBanner, clearCryptoBanner } = useUIStore();

  const {
    showAddContact,
    setShowAddContact,
    newContactUsername,
    setNewContactUsername,
    addContactError,
    addContactLoading,
    handleAddContact,
    openChatForContact,
    resetAddContact,
  } = useContactActions();

  const { isPanicMode, showPanicConfirm, setShowPanicConfirm, executePanic } =
    usePanic();

  const [searchQuery, setSearchQuery] = useState("");
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupOutput, setBackupOutput] = useState("");
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [importInput, setImportInput] = useState("");

  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [selfDestructTime, setSelfDestructTime] = useState<number | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [copiedSafety, setCopiedSafety] = useState(false);
  const [showDeleteContact, setShowDeleteContact] = useState(false);

  const chat = chats.find((c) => c.id === chatId);
  const contact = contacts.find((c) => c.id === chat?.contactId);
  const contactId = contact?.id;
  const isTyping = useTypingStore((s) =>
    contactId ? (s.typingUsers[contactId] ?? false) : false,
  );
  const safetyNumber =
    identityKeys && contact
      ? computeSafetyNumber({
          mySigningPublicKey: identityKeys.signing.publicKey,
          myExchangeIdentityPublicKey: identityKeys.exchange.publicKey,
          theirSigningPublicKey: contact.publicKey,
          theirExchangeIdentityPublicKey: contact.exchangeKey,
        })
      : null;

  useEffect(() => {
    if (hydrated) {
      setActiveChat(chatId);
      markAsRead(chatId);

      // Send read receipts for unread messages from the contact
      if (chat && contactId) {
        const unreadFromContact = chat.messages.filter(
          (m) => m.senderId === contactId && m.status !== 'read',
        );
        if (unreadFromContact.length > 0) {
          wsClient.sendReadReceipt(
            contactId,
            unreadFromContact.map((m) => m.id),
          );
        }
      }
    }
  }, [hydrated, chatId, markAsRead, setActiveChat, chat, contactId]);

  useEffect(() => {
    if (!chat) return;
    if (
      selfDestructTime === null &&
      typeof chat.selfDestructTimer === "number"
    ) {
      setSelfDestructTime(chat.selfDestructTimer);
    }
  }, [chat, selfDestructTime]);

  useEffect(() => {
    if (!hydrated) return;
    if (!userId || !identityKeys) {
      router.push("/unlock");
    }
  }, [hydrated, userId, identityKeys, router]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
      return;
    }
    // Only auto-scroll if the user is already near the bottom (within 120px).
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      120;
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [chat?.messages.length]);

  // Reduce WS traffic: send typing=true once when user starts typing,
  // then typing=false after a short inactivity window.
  useEffect(() => {
    if (!contactId) return undefined;

    const isTypingNow = messageText.trim().length > 0;

    if (!isTypingNow) {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (typingStateRef.current) {
        typingStateRef.current = false;
        wsClient.sendTyping(contactId, false);
      }
      return undefined;
    }

    if (!typingStateRef.current) {
      typingStateRef.current = true;
      wsClient.sendTyping(contactId, true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      typingTimeoutRef.current = null;
      if (typingStateRef.current) {
        typingStateRef.current = false;
        wsClient.sendTyping(contactId, false);
      }
    }, 1200);

    return undefined;
  }, [messageText, contactId]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (contactId && typingStateRef.current) {
        typingStateRef.current = false;
        wsClient.sendTyping(contactId, false);
      }
    };
  }, [contactId]);

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (chatId) {
        deleteMessage(chatId, messageId);
      }
    },
    [chatId, deleteMessage],
  );

  const handleSend = async () => {
    if (!messageText.trim() || !contact || !userId || !identityKeys) return;

    setSending(true);

    const messageId = uuidv4();
    const timestamp = Date.now();
    const outgoingText = messageText;

    const message: Message = {
      id: messageId,
      chatId,
      senderId: userId,
      content: outgoingText,
      type: "text",
      timestamp,
      status: "sending",
      selfDestructAt: selfDestructTime
        ? timestamp + selfDestructTime * 1000
        : undefined,
    };

    addMessage(chatId, message);
    setMessageText("");

    try {
      const plaintext = JSON.stringify({
        content: outgoingText,
        timestamp,
        selfDestruct: selfDestructTime ?? null,
      });
      const plaintextBytes = new TextEncoder().encode(plaintext);

      const sessions = useSessionsStore.getState().sessions;
      const existing = contactId ? sessions[contactId] : undefined;

      let session = existing ? deserializeSession(existing) : null;
      let x3dhInit:
        | {
            senderIdentityKey: string;
            senderEphemeralKey: string;
            recipientOneTimePreKey?: string | null;
          }
        | undefined;

      if (!session) {
        // First message to this contact: do X3DH (bundle is signed) and start a ratchet session.
        const { data: bundle, error: bundleError } = await authApi.getBundle(
          contact.username,
          identityKeys,
        );
        if (bundleError || !bundle) {
          throw new Error(bundleError || "Failed to fetch bundle");
        }

        const ok = verify(
          decodeBase64(bundle.signedPrekey),
          decodeBase64(bundle.signedPrekeySignature),
          bundle.identityKey,
        );
        if (!ok) {
          throw new Error("Invalid signed prekey signature");
        }

        const recipientIk = bundle.exchangeIdentityKey || bundle.exchangeKey;
        if (!recipientIk) {
          throw new Error("Recipient bundle missing exchange identity key");
        }

        const { sharedSecret, ephemeralPublicKey } = x3dhInitiate(
          identityKeys.exchange,
          {
            identityKey: recipientIk,
            signedPreKey: bundle.signedPrekey,
            signature: bundle.signedPrekeySignature,
            oneTimePreKey: bundle.oneTimePrekey,
          },
        );

        session = initSenderSession(sharedSecret, bundle.signedPrekey);
        x3dhInit = {
          senderIdentityKey: identityKeys.exchange.publicKey,
          senderEphemeralKey: ephemeralPublicKey,
          recipientOneTimePreKey: bundle.oneTimePrekey ?? null,
        };
      }

      const encrypted = ratchetEncrypt(session, plaintextBytes);
      const encryptedPayload = encodeRatchetEnvelope({
        encrypted,
        timestamp,
        selfDestruct: selfDestructTime,
        ...(x3dhInit ? { x3dh: x3dhInit } : {}),
      });

      if (contactId) {
        upsertSession(contactId, serializeSession(session));
      }

      const { data, error } = await messagesApi.send(
        {
          senderId: userId,
          recipientUsername: contact.username,
          encryptedPayload,
        },
        identityKeys,
      );

      if (error) {
        updateMessage(chatId, messageId, { status: "failed" });
      } else {
        clearCryptoBanner();
        updateMessage(chatId, messageId, {
          status: data?.delivered ? "delivered" : "sent",
        });
      }
    } catch (sendError) {
      console.error("Send message error:", sendError);
      const msg =
        sendError instanceof Error ? sendError.message : String(sendError);
      if (
        msg.includes("bundle") ||
        msg.includes("signed prekey") ||
        msg.includes("signature") ||
        msg.includes("exchange identity") ||
        msg.includes("Sending chain")
      ) {
        setCryptoBanner({
          level: "warning",
          message: "Cannot establish secure session with this contact.",
        });
      }
      updateMessage(chatId, messageId, { status: "failed" });
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const timerOptions = [
    { value: null, label: "Off" },
    { value: 5, label: "5s" },
    { value: 30, label: "30s" },
    { value: 60, label: "1m" },
    { value: 300, label: "5m" },
  ];

  if (!hydrated) {
    return (
      <MessengerShell
        leftRail={<div className="h-full" />}
        chatList={<ChatListSkeleton />}
        main={
          <div className="lume-panel h-full rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden flex flex-col">
            <div className="px-5 pt-5 pb-4 border-b border-[var(--border)]/70">
              <div className="flex items-center gap-3">
                <span className="block w-10 h-10 rounded-full bg-[var(--surface-alt)] animate-pulse" />
                <span className="block h-3 w-24 rounded-full bg-[var(--surface-alt)] animate-pulse" />
              </div>
            </div>
            <MessagesSkeleton />
          </div>
        }
      />
    );
  }
  if (isPanicMode) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[var(--text-secondary)] uppercase tracking-[0.18em] text-sm">
          No messages
        </p>
      </div>
    );
  }

  if (!chat || !contact) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-[var(--text-secondary)] uppercase tracking-[0.18em] text-sm">
            Chat not found
          </p>
          <button
            onClick={() => router.push("/chats")}
            className="mt-4 apple-button-secondary px-6"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const chatListNode = (
    <ChatListPanel
      chats={chats}
      contacts={contacts}
      selectedChatId={chatId}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onSelectChat={(id) => {
        setActiveChat(id);
        router.push(`/chat/${id}`);
      }}
      onNewChat={() => setShowAddContact(true)}
    />
  );

  const chatViewNode = (
    <div className="lume-panel h-full min-h-0 rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden flex flex-col">
      <header className="px-5 sm:px-6 py-4 border-b border-[var(--border)]/70">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => router.push("/chats")}
              className="lume-icon-btn md:hidden"
              aria-label="Back"
              title="Back"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setShowProfile(true)}
              className="flex items-center gap-3 min-w-0 hover:bg-[var(--surface-alt)] rounded-[18px] px-2 py-1.5 transition-colors"
            >
              <div className="w-11 h-11 rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] p-[2px] flex-shrink-0">
                <div className="lume-avatar w-full h-full rounded-full border border-[var(--border)] flex items-center justify-center text-[var(--text-primary)] text-[16px] font-semibold">
                  {contact.username[0].toUpperCase()}
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--text-primary)] truncate">
                  @{contact.username}
                </p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  {isTyping ? (
                    <span className="lume-badge">Typing...</span>
                  ) : null}
                  {selfDestructTime ? (
                    <span className="lume-badge">
                      Auto-delete {selfDestructTime}s
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              className="lume-icon-btn"
              aria-label="Options"
              title="Options"
            >
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 6v.01M12 12v.01M12 18v.01"
                />
              </svg>
            </button>
          </div>
        </div>

        {showOptions ? (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Auto-delete
            </span>
            {timerOptions.map((opt) => (
              <button
                key={opt.value ?? "off"}
                type="button"
                onClick={() => {
                  setSelfDestructTime(opt.value);
                  setSelfDestructTimer(chatId, opt.value ?? undefined);
                }}
                className={`
                  px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors
                  ${
                    selfDestructTime === opt.value
                      ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                      : "bg-[var(--surface-strong)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]"
                  }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <main
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-2"
      >
        {chat.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6">
            <div className="w-16 h-16 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] flex items-center justify-center text-[var(--text-muted)]">
              <svg
                className="w-8 h-8"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                  d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8z"
                />
              </svg>
            </div>
            <p className="mt-4 text-[13px] font-semibold text-[var(--text-primary)]">
              No messages yet
            </p>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">
              Send the first message.
            </p>
          </div>
        ) : (
          <>
            {chat.messages.map((m) => (
              <MessageBubbleMemo
                key={m.id}
                message={m}
                isMine={m.senderId === userId}
                onDelete={handleDeleteMessage}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </main>

      <footer className="px-5 sm:px-6 py-4 border-t border-[var(--border)]/70">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type message..."
              rows={1}
              className="w-full px-4 py-3 bg-[var(--surface-strong)] rounded-full border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] resize-none shadow-[var(--shadow-sm)]"
              style={{ minHeight: "48px", maxHeight: "140px" }}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!messageText.trim() || sending}
            className="w-12 h-12 rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] border border-[var(--border)] hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center flex-shrink-0 shadow-[var(--shadow-sm)]"
            aria-label="Send"
            title="Send"
          >
            {sending ? (
              <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                />
              </svg>
            )}
          </button>
        </div>

        {selfDestructTime ? (
          <div className="mt-2 text-center">
            <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Auto-delete in {selfDestructTime}s
            </span>
          </div>
        ) : null}
      </footer>
    </div>
  );

  return (
    <div className="h-[100dvh] w-full overflow-hidden">
      {/* Mobile: chat only */}
      <div className="md:hidden h-full min-h-0 p-3 sm:p-5">{chatViewNode}</div>

      {/* Desktop: dashboard shell */}
      <div className="hidden md:block h-full min-h-0">
        <MessengerShell
          leftRail={
            <LeftRail
              onPanic={() => setShowPanicConfirm(true)}
              onOpenBackup={() => setShowBackupModal(true)}
            />
          }
          chatList={chatListNode}
          main={chatViewNode}
          rightRail={
            contacts.length > 0 ? (
              <RightRail
                contacts={contacts}
                chats={chats}
                activeChatId={activeChatId}
                onOpenContact={openChatForContact}
              />
            ) : undefined
          }
        />
      </div>

      <Modal
        isOpen={showAddContact}
        onClose={resetAddContact}
        title="Start Chat"
      >
        <div className="space-y-4">
          <Input
            label="Recipient Username"
            value={newContactUsername}
            onChange={(e) =>
              setNewContactUsername(e.target.value.replace(/^@+/, ""))
            }
            placeholder="username"
            error={addContactError}
            icon={<span className="text-[var(--text-muted)]">@</span>}
          />
          <Button
            fullWidth
            onClick={handleAddContact}
            loading={addContactLoading}
            disabled={!newContactUsername}
          >
            Start
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={showPanicConfirm}
        onClose={() => setShowPanicConfirm(false)}
        title="Wipe Data?"
      >
        <div className="space-y-6">
          <p className="text-[var(--text-secondary)]">
            This will delete all local keys, contacts and messages on this
            device. It cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setShowPanicConfirm(false)}
              className="flex-1 apple-button-secondary"
            >
              Cancel
            </button>
            <button onClick={executePanic} className="flex-1 apple-button">
              Wipe
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showProfile}
        onClose={() => setShowProfile(false)}
        title="Contact Profile"
      >
        <div className="flex flex-col items-center pt-2 pb-6">
          <div className="w-24 h-24 bg-[var(--surface-strong)] rounded-full flex items-center justify-center text-[var(--text-primary)] text-4xl font-semibold mb-4 border border-[var(--border)]">
            {contact.username[0].toUpperCase()}
          </div>
          <h2 className="text-[14px] font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)] mb-1">
            @{contact.username}
          </h2>
          <p className="text-[12px] text-[var(--text-muted)] mb-6">LUME User</p>

          {identityKeys ? (
            <div className="w-full bg-[var(--surface-alt)] rounded-[var(--radius-md)] p-5 border border-[var(--border)] text-center">
              <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                Safety number
              </p>
              <p className="mt-3 text-[14px] font-semibold tracking-[0.12em] text-[var(--text-primary)] leading-relaxed">
                {safetyNumber}
              </p>

              <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="apple-button-secondary px-4"
                  onClick={async () => {
                    if (!safetyNumber) return;
                    await navigator.clipboard.writeText(safetyNumber);
                    setCopiedSafety(true);
                    setTimeout(() => setCopiedSafety(false), 1200);
                  }}
                >
                  {copiedSafety ? "Copied" : "Copy"}
                </button>

                <button
                  type="button"
                  className={`px-4 py-3 rounded-full border transition-colors text-[12px] font-semibold uppercase tracking-[0.08em] ${
                    contact.verified
                      ? "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--border)]"
                      : "bg-[var(--surface-strong)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--surface)]"
                  }`}
                  onClick={async () => {
                    const nextVerified = !contact.verified;
                    useContactsStore.getState().updateContact(contact.id, {
                      verified: nextVerified,
                      verifiedAt: nextVerified ? Date.now() : undefined,
                    });
                  }}
                >
                  {contact.verified ? "Verified" : "Mark verified"}
                </button>
              </div>

              <p className="mt-4 text-[12px] text-[var(--text-muted)]">
                Compare this number with your contact out of band. If it
                matches, mark verified.
              </p>
            </div>
          ) : null}

          {/* Delete Contact */}
          {!showDeleteContact ? (
            <button
              type="button"
              className="mt-6 w-full py-3 rounded-full border border-red-500/30 text-red-400 text-[12px] font-semibold uppercase tracking-[0.08em] hover:bg-red-500/10 transition-colors"
              onClick={() => setShowDeleteContact(true)}
            >
              Delete Contact
            </button>
          ) : (
            <div className="mt-6 p-4 rounded-[var(--radius-md)] border border-red-500/30 bg-red-500/5">
              <p className="text-[12px] text-red-400 mb-3 text-center">
                This will delete the contact, chat history, and encryption session. This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteContact(false)}
                  className="flex-1 apple-button-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!contact || !contactId) return;
                    deleteChat(chatId);
                    deleteSession(contactId);
                    removeContact(contactId);
                    setShowProfile(false);
                    setShowDeleteContact(false);
                    router.push('/chats');
                  }}
                  className="flex-1 py-3 rounded-full border border-red-500/30 bg-red-500/20 text-red-400 text-[12px] font-semibold uppercase tracking-[0.08em] hover:bg-red-500/30 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={showBackupModal}
        onClose={() => setShowBackupModal(false)}
        title="Backup & Restore"
      >
        <div className="space-y-4">
          <p className="text-[var(--text-secondary)] text-sm">
            Export keys/chats/contacts as an encrypted blob (requires current
            PIN). Store offline.
          </p>
          <Button
            fullWidth
            loading={backupLoading}
            onClick={async () => {
              if (!pin) {
                setBackupStatus("PIN required (unlock session first).");
                return;
              }
              setBackupStatus(null);
              setBackupLoading(true);
              try {
                const data = await exportEncryptedBackup(pin);
                setBackupOutput(data);
                await navigator.clipboard
                  .writeText(data)
                  .catch(() => undefined);
                setBackupStatus(
                  "Backup ready (copied to clipboard if allowed).",
                );
              } catch (e) {
                setBackupStatus("Backup error: " + (e as Error).message);
              } finally {
                setBackupLoading(false);
              }
            }}
          >
            Export
          </Button>

          {backupOutput && (
            <textarea
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-xs p-3 font-mono"
              rows={5}
              readOnly
              value={backupOutput}
            />
          )}

          <div className="space-y-2">
            <textarea
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-xs p-3 font-mono"
              rows={4}
              placeholder="Paste encrypted backup here"
              value={importInput}
              onChange={(e) => setImportInput(e.target.value.trim())}
            />
            <Button
              fullWidth
              variant="secondary"
              loading={backupLoading}
              disabled={!importInput}
              onClick={async () => {
                if (!pin) {
                  setBackupStatus("PIN required (unlock session first).");
                  return;
                }
                setBackupStatus(null);
                setBackupLoading(true);
                try {
                  await importEncryptedBackup(importInput, pin);
                  setBackupStatus("Backup restored. Restart the application.");
                } catch (e) {
                  setBackupStatus("Restore error: " + (e as Error).message);
                } finally {
                  setBackupLoading(false);
                }
              }}
            >
              Restore
            </Button>
          </div>

          {backupStatus && (
            <p className="text-xs text-[var(--text-secondary)]">
              {backupStatus}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
