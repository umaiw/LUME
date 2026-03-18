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
  useBlockedStore,
  type Message,
} from "@/stores";
import { authApi, messagesApi } from "@/lib/api";
import { wsClient } from "@/lib/websocket";
import { exportEncryptedBackup, importEncryptedBackup } from "@/crypto/storage";
import { reconcileRestoreConsistency } from "@/lib/settingsConsistency";
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
        className={`${base}${status === "read" ? " text-blue-400" : ""}`}
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

function formatCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  if (totalSec < 3600) return `${Math.floor(totalSec / 60)}m ${totalSec % 60}s`;
  if (totalSec < 86400) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function MessageBubble({
  message,
  isMine,
  onDelete,
  onReply,
  replyAuthorName,
}: {
  message: Message;
  isMine: boolean;
  onDelete: (messageId: string) => void;
  onReply: (message: Message) => void;
  replyAuthorName?: string;
}) {
  const [showActions, setShowActions] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const timeLabel = new Date(message.timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  useEffect(() => {
    if (!message.selfDestructAt) return undefined;
    const update = () => {
      const left = message.selfDestructAt! - Date.now();
      setRemaining(left > 0 ? left : 0);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [message.selfDestructAt]);

  return (
    <div className={`group flex ${isMine ? "justify-end" : "justify-start"}`}>
      {/* Action buttons — left of own messages */}
      {isMine && (
        <div className="self-center mr-2 flex items-center gap-1 opacity-0 group-hover:opacity-60 transition-opacity">
          <button
            type="button"
            onClick={() => onReply(message)}
            className="hover:!opacity-100 p-1"
            title="Reply"
          >
            <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10l7-7m0 0v14m0-14h4a8 8 0 018 8v5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setShowActions(!showActions)}
            className="hover:!opacity-100 p-1"
            title="Delete message"
          >
            <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      )}
      <div className="relative max-w-[85%] sm:max-w-[78%]">
        <div
          className={`px-4 py-2.5 ${isMine ? "message-bubble-sent" : "message-bubble-received"}`}
        >
          {/* Reply preview */}
          {message.replyTo && (
            <div className="mb-2 pl-3 border-l-2 border-[var(--accent)]/60 rounded-sm">
              <p className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-[0.06em] mb-0.5 truncate">
                {replyAuthorName || 'Unknown'}
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] truncate leading-snug">
                {message.replyTo.content.length > 80 ? message.replyTo.content.slice(0, 80) + '…' : message.replyTo.content}
              </p>
            </div>
          )}
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
              <span className="inline-flex items-center gap-0.5">
                <svg
                  className="w-3.5 h-3.5"
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
                {remaining !== null && remaining > 0 ? (
                  <span className="text-[10px] tracking-[0.04em]">
                    {formatCountdown(remaining)}
                  </span>
                ) : null}
              </span>
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
      {/* Action buttons — right of received messages */}
      {!isMine && (
        <div className="self-center ml-2 flex items-center gap-1 opacity-0 group-hover:opacity-60 transition-opacity">
          <button
            type="button"
            onClick={() => onReply(message)}
            className="hover:!opacity-100 p-1"
            title="Reply"
          >
            <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10l7-7m0 0v14m0-14h4a8 8 0 018 8v5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setShowActions(!showActions)}
            className="hover:!opacity-100 p-1"
            title="Delete message"
          >
            <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
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
    prev.message.replyTo?.messageId === next.message.replyTo?.messageId &&
    prev.replyAuthorName === next.replyAuthorName &&
    prev.onDelete === next.onDelete &&
    prev.onReply === next.onReply,
);

export default function ChatPage({ params }: ChatPageProps) {
  const { id: chatId } = use(params);
  const router = useRouter();
  const { hydrated } = useMessengerSync();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingStateRef = useRef(false);

  const { userId, identityKeys, masterKey } = useAuthStore();
  const { contacts, removeContact } = useContactsStore();
  const { upsertSession, deleteSession } = useSessionsStore();
  const {
    chats,
    addMessage,
    updateMessage,
    deleteMessage,
    deleteChat,
    setChatHidden,
    markAsRead,
    setSelfDestructTimer,
    activeChatId,
    setActiveChat,
  } = useChatsStore();
  const {
    setCryptoBanner,
    clearCryptoBanner,
    showHiddenChats,
    setShowHiddenChats,
  } = useUIStore();

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
  const [backupPin, setBackupPin] = useState("");

  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [selfDestructTime, setSelfDestructTime] = useState<number | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [copiedSafety, setCopiedSafety] = useState(false);
  const [showDeleteContact, setShowDeleteContact] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [blockLoading, setBlockLoading] = useState(false);

  const chat = chats.find((c) => c.id === chatId);
  const contact = contacts.find((c) => c.id === chat?.contactId);
  const contactId = contact?.id;

  const isContactBlocked = useBlockedStore((s) =>
    contactId ? !!s.blockedIds[contactId] : false,
  );

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
    if (!hydrated) return;
    setActiveChat(chatId);
    markAsRead(chatId);

    // Send read receipts for unread messages from the contact
    if (contactId) {
      const currentChat = useChatsStore.getState().chats.find((c) => c.id === chatId);
      if (currentChat) {
        const unreadFromContact = currentChat.messages.filter(
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
  }, [hydrated, chatId, contactId, markAsRead, setActiveChat]);

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
    if (!hydrated || !chat) return;
    if (chat.isHidden && !showHiddenChats) {
      router.push("/chats");
    }
  }, [hydrated, chat, showHiddenChats, router]);

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

  const handleReply = useCallback(
    (message: Message) => {
      setReplyingTo(message);
    },
    [],
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
      replyTo: replyingTo
        ? { messageId: replyingTo.id, content: replyingTo.content, senderId: replyingTo.senderId }
        : undefined,
    };

    addMessage(chatId, message);
    setMessageText("");
    setReplyingTo(null);

    try {
      const replyRef = replyingTo
        ? { messageId: replyingTo.id, content: replyingTo.content.slice(0, 200), senderId: replyingTo.senderId }
        : undefined;
      const plaintext = JSON.stringify({
        content: outgoingText,
        timestamp,
        selfDestruct: selfDestructTime ?? null,
        ...(replyRef ? { replyTo: replyRef } : {}),
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
            signingKey: bundle.identityKey,
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
    { value: 30, label: "30s" },
    { value: 300, label: "5m" },
    { value: 3600, label: "1h" },
    { value: 86400, label: "24h" },
    { value: 604800, label: "7d" },
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
      <header className="px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-[var(--border)]/70">
        <div className="flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
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
                      Auto-delete {selfDestructTime >= 86400 ? `${Math.floor(selfDestructTime / 86400)}d` : selfDestructTime >= 3600 ? `${Math.floor(selfDestructTime / 3600)}h` : selfDestructTime >= 60 ? `${Math.floor(selfDestructTime / 60)}m` : `${selfDestructTime}s`}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
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
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 md:px-6 py-4 sm:py-5 space-y-2"
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
            {chat.messages.map((m) => {
              let replyAuthorName: string | undefined;
              if (m.replyTo) {
                if (m.replyTo.senderId === userId) {
                  replyAuthorName = 'You';
                } else {
                  replyAuthorName = contacts.find((c) => c.id === m.replyTo!.senderId)?.username || 'Unknown';
                }
              }
              return (
                <MessageBubbleMemo
                  key={m.id}
                  message={m}
                  isMine={m.senderId === userId}
                  onDelete={handleDeleteMessage}
                  onReply={handleReply}
                  replyAuthorName={replyAuthorName}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </main>

      <footer className="px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-t border-[var(--border)]/70">
        {/* Reply bar */}
        {replyingTo && (
          <div className="mb-3 flex items-start gap-3 px-4 py-2.5 rounded-[var(--radius-md)] bg-[var(--surface-alt)] border border-[var(--border)]">
            <div className="flex-1 min-w-0 pl-3 border-l-2 border-[var(--accent)]">
              <p className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-[0.06em] mb-0.5">
                {replyingTo.senderId === userId ? 'You' : (contact?.username || 'Unknown')}
              </p>
              <p className="text-[12px] text-[var(--text-secondary)] truncate">
                {replyingTo.content.length > 100 ? replyingTo.content.slice(0, 100) + '…' : replyingTo.content}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setReplyingTo(null)}
              className="flex-shrink-0 p-1 rounded-full hover:bg-[var(--surface-strong)] transition-colors"
              aria-label="Cancel reply"
            >
              <svg className="w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type message..."
              rows={1}
              className="w-full px-4 py-3 bg-[var(--surface-strong)] rounded-full border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] resize-none shadow-[var(--shadow-sm)] text-[16px] leading-snug"
              style={{ minHeight: "48px", maxHeight: "140px" }}
            />
          </div>
          <button
            type="button"
            onClick={() => setShowOptions((v) => !v)}
            className={`w-10 h-10 rounded-full border transition-colors inline-flex items-center justify-center flex-shrink-0 ${
              selfDestructTime
                ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]"
                : "bg-[var(--surface-strong)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            aria-label="Self-destruct timer"
            title={selfDestructTime ? `Auto-delete: ${selfDestructTime >= 86400 ? `${Math.floor(selfDestructTime / 86400)}d` : selfDestructTime >= 3600 ? `${Math.floor(selfDestructTime / 3600)}h` : selfDestructTime >= 60 ? `${Math.floor(selfDestructTime / 60)}m` : `${selfDestructTime}s`}` : "Self-destruct timer"}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v5l3 2" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
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
              Auto-delete in {selfDestructTime >= 86400 ? `${Math.floor(selfDestructTime / 86400)}d` : selfDestructTime >= 3600 ? `${Math.floor(selfDestructTime / 3600)}h` : selfDestructTime >= 60 ? `${Math.floor(selfDestructTime / 60)}m` : `${selfDestructTime}s`}
            </span>
          </div>
        ) : null}
      </footer>
    </div>
  );

  return (
    <div className="h-[100dvh] w-full overflow-hidden">
      {/* Mobile: chat only — no horizontal padding so the panel fills edge-to-edge */}
      <div className="md:hidden h-full min-h-0 p-2 sm:p-4">{chatViewNode}</div>

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

          {/* Block / Unblock Contact */}
          <button
            type="button"
            disabled={blockLoading}
            className={`mt-6 w-full py-3 rounded-full border text-[12px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-60 ${
              isContactBlocked
                ? 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-alt)]'
                : 'border-orange-500/30 text-orange-400 hover:bg-orange-500/10'
            }`}
            onClick={async () => {
              if (!contactId || !identityKeys) return;
              setBlockLoading(true);
              try {
                if (isContactBlocked) {
                  await authApi.unblockUser(contactId, identityKeys);
                  useBlockedStore.getState().removeBlocked(contactId);
                } else {
                  await authApi.blockUser(contactId, identityKeys);
                  useBlockedStore.getState().addBlocked(contactId);
                }
              } catch {
                // Best effort — local state still toggles
              } finally {
                setBlockLoading(false);
              }
            }}
          >
            {blockLoading ? 'Processing…' : isContactBlocked ? 'Unblock Contact' : 'Block Contact'}
          </button>

          <button
            type="button"
            className="mt-4 w-full py-3 rounded-full border border-[var(--border)] text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] hover:bg-[var(--surface-alt)] transition-colors"
            onClick={() => {
              const nextHidden = !chat.isHidden;
              setChatHidden(chatId, nextHidden);
              if (nextHidden) {
                setShowHiddenChats(false);
                setShowProfile(false);
                router.push('/chats');
              }
            }}
          >
            {chat.isHidden ? 'Unhide Chat' : 'Hide Chat'}
          </button>

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
            Export keys/chats/contacts as an encrypted blob. Enter your PIN to
            encrypt/decrypt. Store offline.
          </p>
          <input
            type="password"
            value={backupPin}
            onChange={(e) => setBackupPin(e.target.value)}
            placeholder="Enter PIN"
            className="apple-input text-center tracking-[0.2em]"
          />
          <Button
            fullWidth
            loading={backupLoading}
            onClick={async () => {
              if (!masterKey || !backupPin) {
                setBackupStatus("Enter your PIN to export backup.");
                return;
              }
              setBackupStatus(null);
              setBackupLoading(true);
              try {
                const data = await exportEncryptedBackup(masterKey, backupPin);
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
                if (!backupPin) {
                  setBackupStatus("Enter your PIN to restore backup.");
                  return;
                }
                setBackupStatus(null);
                setBackupLoading(true);
                try {
                  await importEncryptedBackup(importInput, backupPin);
                  await reconcileRestoreConsistency();
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
