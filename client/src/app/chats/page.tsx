/**
 * Messenger: chats list / dashboard shell (desktop)
 * Mobile shows only the chats list.
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal } from "@/components/ui";
import MessengerShell from "@/components/messenger/MessengerShell";
import MobileSwipeShell from "@/components/messenger/MobileSwipeShell";
import LeftRail from "@/components/messenger/LeftRail";
import ChatListPanel from "@/components/messenger/ChatListPanel";
import RightRail from "@/components/messenger/RightRail";
import { useMessengerSync } from "@/hooks/useMessengerSync";
import { useContactActions } from "@/hooks/useContactActions";
import { usePanic } from "@/hooks/usePanic";
import { useAuthStore, useContactsStore, useChatsStore } from "@/stores";
import { exportEncryptedBackup, importEncryptedBackup } from "@/crypto/storage";
import { ChatListSkeleton } from "@/components/ui";

export default function ChatsPage() {
  const router = useRouter();

  const { hydrated } = useMessengerSync();
  const { isAuthenticated, masterKey } = useAuthStore();
  const { contacts } = useContactsStore();
  const { chats, activeChatId, setActiveChat } = useChatsStore();

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

  // Auth guard — redirect in useEffect to avoid render-phase side effects.
  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.push("/");
    }
  }, [hydrated, isAuthenticated, router]);

  if (!hydrated) {
    return (
      <MessengerShell
        leftRail={<div className="h-full" />}
        chatList={<ChatListSkeleton />}
        main={
          <div aria-busy="true" className="lume-panel h-full rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] flex items-center justify-center">
            <div className="w-8 h-8 border-2 mono-spinner rounded-full animate-spin" />
          </div>
        }
      />
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const handleSelectChat = (chatId: string) => {
    setActiveChat(chatId);
    router.push(`/chat/${chatId}`);
  };

  if (isPanicMode) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[var(--text-secondary)] uppercase tracking-[0.18em] text-sm">
          No messages
        </p>
      </div>
    );
  }

  const emptyMain = (
    <div className="lume-panel h-full min-h-0 rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="h-full flex flex-col items-center justify-center px-8 text-center">
        <div className="w-16 h-16 rounded-full border border-[var(--border)] bg-[var(--surface-strong)] shadow-[var(--shadow-sm)] flex items-center justify-center text-[var(--text-muted)]">
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
        <h3 className="mt-5 text-[14px] font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)]">
          Select a chat
        </h3>
        <p className="mt-2 text-[12px] text-[var(--text-muted)] max-w-sm">
          Choose a conversation from the list or start a new one.
        </p>
        <div className="mt-6 w-full max-w-xs">
          <button
            className="apple-button"
            onClick={() => setShowAddContact(true)}
          >
            Start Chat
          </button>
        </div>
      </div>
    </div>
  );

  const chatListNode = (
    <ChatListPanel
      chats={chats}
      contacts={contacts}
      selectedChatId={activeChatId}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onSelectChat={handleSelectChat}
      onNewChat={() => setShowAddContact(true)}
    />
  );

  const leftRailNode = (
    <LeftRail
      onPanic={() => setShowPanicConfirm(true)}
      onOpenBackup={() => setShowBackupModal(true)}
    />
  );

  return (
    <div className="h-[100dvh] w-full overflow-hidden">
      {/* Mobile: swipeable Profile + Messages panels */}
      <div className="md:hidden h-full min-h-0 p-2 sm:p-3">
        <MobileSwipeShell
          profilePanel={leftRailNode}
          chatListPanel={chatListNode}
        />
      </div>

      {/* Desktop: 4-column dashboard like the reference */}
      <div className="hidden md:block h-full min-h-0">
        <MessengerShell
          leftRail={leftRailNode}
          chatList={chatListNode}
          main={emptyMain}
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
            aria-label="Backup PIN"
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
              aria-label="Exported backup data"
              value={backupOutput}
            />
          )}

          <div className="space-y-2">
            <textarea
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] text-xs p-3 font-mono"
              rows={4}
              placeholder="Paste encrypted backup here"
              aria-label="Import backup data"
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
