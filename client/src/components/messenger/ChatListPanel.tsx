'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Chat } from '@/stores';
import { useAuthStore, useBlockedStore, useChatsStore, useGroupsStore, useUIStore } from '@/stores';
import type { GroupData } from '@/lib/api';
import { loadSettings, verifyHiddenChatPin, isLegacyHiddenPinHash, hashHiddenChatPin, saveSettings, type Contact } from '@/crypto/storage';
import { Avatar, Button, Input, Modal } from '@/components/ui';

function formatTime(timestamp?: number) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function ChatRow({
  chat,
  contact,
  selected,
  onClick,
  showHiddenControls,
  onToggleHidden,
  searchHighlight,
}: {
  chat: Chat;
  contact: Contact;
  selected: boolean;
  onClick: () => void;
  showHiddenControls: boolean;
  onToggleHidden: (chatId: string) => void;
  searchHighlight?: string;
}) {
  const timeLabel = formatTime(chat.lastMessage?.timestamp);
  const isBlocked = useBlockedStore((s) => !!s.blockedIds[contact.id]);
  const matchedMessage = searchHighlight
    ? chat.messages.find((m) => m.content.toLowerCase().includes(searchHighlight))
    : null;
  const preview = isBlocked
    ? 'Blocked'
    : matchedMessage
      ? matchedMessage.content
      : (chat.lastMessage?.content || 'Start messaging');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative w-full px-4 py-3.5 sm:py-3 text-left transition-colors
        border-b border-[var(--border)]/55 last:border-b-0
        min-h-[56px] sm:min-h-0
        ${selected ? 'bg-[var(--surface-strong)] text-[var(--text-primary)]' : 'hover:bg-[var(--surface-alt)] active:bg-[var(--surface-strong)] text-[var(--text-primary)]'}
      `}
    >
      {selected ? <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accent)]" aria-hidden="true" /> : null}
      <div className="flex items-center gap-3">
        <Avatar username={contact.username} size="lg" />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                @{contact.username}
              </p>
              <p className="truncate text-[12px] mt-0.5 text-[var(--text-secondary)]">
                {preview}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2 flex-shrink-0">
              {timeLabel ? (
                <span className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  {timeLabel}
                </span>
              ) : null}
              {showHiddenControls ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleHidden(chat.id);
                  }}
                  className="w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-alt)] transition-colors inline-flex items-center justify-center"
                  aria-label={chat.isHidden ? 'Unhide chat' : 'Hide chat'}
                  title={chat.isHidden ? 'Unhide chat' : 'Hide chat'}
                >
                  {chat.isHidden ? (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M13.875 18.825A10.05 10.05 0 0112 19C7 19 2.73 15.11 1 12c.52-.94 1.19-1.82 1.97-2.62M9.9 4.24A9.96 9.96 0 0112 4c5 0 9.27 3.89 11 8a14.56 14.56 0 01-4.2 4.91M15 12a3 3 0 10-4.24 2.73" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 3l18 18" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M1 12c1.73-3.11 6-7 11-7s9.27 3.89 11 7c-1.73 3.11-6 7-11 7S2.73 15.11 1 12z" />
                      <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
                    </svg>
                  )}
                </button>
              ) : null}
              {chat.unreadCount > 0 ? (
                <span
                  className={`
                    min-w-5 h-5 px-1.5 rounded-full text-[11px] font-semibold flex items-center justify-center
                    bg-[var(--accent)] text-[var(--accent-contrast)]
                  `}
                >
                  {chat.unreadCount > 9 ? '9+' : chat.unreadCount}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function GroupRow({
  group,
  selected,
  onClick,
}: {
  group: GroupData;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative w-full px-4 py-3.5 sm:py-3 text-left transition-colors
        border-b border-[var(--border)]/55 last:border-b-0
        min-h-[56px] sm:min-h-0
        ${selected ? 'bg-[var(--surface-strong)] text-[var(--text-primary)]' : 'hover:bg-[var(--surface-alt)] active:bg-[var(--surface-strong)] text-[var(--text-primary)]'}
      `}
    >
      {selected ? <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accent)]" aria-hidden="true" /> : null}
      <div className="flex items-center gap-3">
        <div
          className={`
            w-11 h-11 rounded-full border flex items-center justify-center flex-shrink-0
            shadow-[var(--shadow-sm)]
            ${selected ? 'border-[var(--accent)]/35 bg-[var(--surface)]' : 'border-[var(--border)] bg-[var(--surface)]'}
          `}
        >
          <svg className="w-5 h-5 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
            <circle cx="9" cy="7" r="4" strokeWidth="1.8" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M23 21v-2a4 4 0 00-3-3.87" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
                {group.name}
              </p>
              <p className="truncate text-[12px] mt-0.5 text-[var(--text-secondary)]">
                {group.members.length} {group.members.length === 1 ? 'member' : 'members'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

export default function ChatListPanel({
  chats,
  contacts,
  selectedChatId,
  searchQuery,
  onSearchChange,
  onSelectChat,
  onNewChat,
  onNewGroup,
}: {
  chats: Chat[];
  contacts: Contact[];
  selectedChatId: string | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onNewGroup?: () => void;
}) {
  const router = useRouter();
  const masterKey = useAuthStore((s) => s.masterKey);
  const showHiddenChats = useUIStore((s) => s.showHiddenChats);
  const setShowHiddenChats = useUIStore((s) => s.setShowHiddenChats);
  const setChatHidden = useChatsStore((s) => s.setChatHidden);
  const groups = useGroupsStore((s) => s.groups);
  const activeGroupId = useGroupsStore((s) => s.activeGroupId);
  const setActiveGroup = useGroupsStore((s) => s.setActiveGroup);

  const [activeTab, setActiveTab] = useState<'chats' | 'groups'>('chats');
  const [hiddenChatsEnabled, setHiddenChatsEnabled] = useState(false);
  const [hiddenChatPinHash, setHiddenChatPinHash] = useState<string | null>(null);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [hiddenPin, setHiddenPin] = useState('');
  const [hiddenPinError, setHiddenPinError] = useState('');

  const reloadSettings = useCallback(async () => {
    try {
      const settings = await loadSettings(masterKey ?? undefined);
      setHiddenChatsEnabled(!!settings.hiddenChatsEnabled);
      setHiddenChatPinHash(settings.hiddenChatPinHash || null);
      if (!settings.hiddenChatsEnabled) {
        setShowHiddenChats(false);
      }
    } catch {
      // ignore
    }
  }, [masterKey, setShowHiddenChats]);

  // Initial load
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadSettings();
  }, [reloadSettings]);

  // Re-sync settings when the user returns to this view after visiting Settings.
  // MessengerShell stays mounted during route navigation, so mount-only load is
  // insufficient — we listen for window focus and document visibility changes.
  useEffect(() => {
    const handleFocus = () => void reloadSettings();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void reloadSettings();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [reloadSettings]);

  const openHiddenUnlock = () => {
    setHiddenPin('');
    setHiddenPinError('');
    setShowUnlockModal(true);
  };

  const toggleHiddenView = () => {
    if (!hiddenChatsEnabled) return;
    if (showHiddenChats) {
      setShowHiddenChats(false);
      return;
    }
    if (hiddenChatPinHash) {
      openHiddenUnlock();
      return;
    }
    setShowHiddenChats(true);
  };

  const [hiddenAttempts, setHiddenAttempts] = useState(0);
  const [hiddenLockUntil, setHiddenLockUntil] = useState(0);

  const unlockHiddenChats = async () => {
    if (!hiddenChatPinHash) {
      setShowHiddenChats(true);
      setShowUnlockModal(false);
      return;
    }
    if (hiddenLockUntil > Date.now()) {
      const secs = Math.ceil((hiddenLockUntil - Date.now()) / 1000);
      setHiddenPinError(`Too many attempts. Try again in ${secs}s`);
      return;
    }
    if (hiddenPin.trim().length < 4) {
      setHiddenPinError('PIN must be at least 4 characters');
      return;
    }
    const ok = await verifyHiddenChatPin(hiddenPin, hiddenChatPinHash);
    if (!ok) {
      const next = hiddenAttempts + 1;
      setHiddenAttempts(next);
      setHiddenPin('');
      if (next >= 5) {
        const lockMs = Math.min(30000 * Math.pow(2, next - 5), 300000);
        setHiddenLockUntil(Date.now() + lockMs);
      }
      setHiddenPinError('Invalid hidden chats PIN');
      return;
    }
    setHiddenAttempts(0);
    // Transparent migration: re-hash legacy PINs with stronger iterations
    if (isLegacyHiddenPinHash(hiddenChatPinHash)) {
      const newHash = await hashHiddenChatPin(hiddenPin);
      const settings = await loadSettings();
      settings.hiddenChatPinHash = newHash;
      await saveSettings(settings);
    }
    setShowHiddenChats(true);
    setShowUnlockModal(false);
    setHiddenPin('');
    setHiddenPinError('');
  };

  const toggleChatHidden = (chatId: string) => {
    const target = chats.find((c) => c.id === chatId);
    if (!target) return;

    if (!hiddenChatsEnabled) return;
    setChatHidden(chatId, !target.isHidden);
  };

  const modeScopedChats = chats
    .filter((chat) => {
      if (!hiddenChatsEnabled) return true;
      return showHiddenChats ? chat.isHidden : !chat.isHidden;
    });

  const query = searchQuery.trim().toLowerCase();

  const filtered = modeScopedChats
    .filter((chat) => {
      const contact = contacts.find((c) => c.id === chat.contactId);
      if (!contact) return false;
      if (!query) return true;
      // Match contact username
      if (contact.username.toLowerCase().includes(query)) return true;
      // Match message content
      return chat.messages.some((m) => m.content.toLowerCase().includes(query));
    });

  const filteredGroups = groups.filter((g) => {
    if (!query) return true;
    return g.name.toLowerCase().includes(query);
  });

  const handleSelectGroup = (groupId: string) => {
    setActiveGroup(groupId);
    // Clear individual chat selection when selecting a group
    onSelectChat('');
  };

  return (
    <div className="lume-panel h-full min-h-0 rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden flex flex-col animate-fade-in">
      <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-[var(--border)]/70 flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)]">
              {activeTab === 'chats' ? 'Messages' : 'Groups'}
            </h2>
            {activeTab === 'chats' && hiddenChatsEnabled ? (
              <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {showHiddenChats ? 'Hidden mode' : 'Main mode'}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Settings shortcut — mobile only (desktop has LeftRail) */}
            <button
              type="button"
              onClick={() => router.push('/settings')}
              className="lume-icon-btn md:hidden"
              aria-label="Settings"
              title="Settings"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
            {activeTab === 'chats' && hiddenChatsEnabled ? (
              <button
                type="button"
                onClick={toggleHiddenView}
                className="lume-icon-btn"
                aria-label={showHiddenChats ? 'Back to main chats' : 'Open hidden chats'}
                title={showHiddenChats ? 'Main chats' : 'Hidden chats'}
              >
                {showHiddenChats ? (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 19l-7-7 7-7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 11c1.657 0 3-1.567 3-3.5S13.657 4 12 4 9 5.567 9 7.5 10.343 11 12 11z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M6 11v7a1 1 0 001 1h10a1 1 0 001-1v-7" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 11V8.5C9 6.567 10.343 5 12 5s3 1.567 3 3.5V11" />
                  </svg>
                )}
              </button>
            ) : null}
            <button
              type="button"
              onClick={activeTab === 'chats' ? onNewChat : (onNewGroup ?? onNewChat)}
              className="lume-icon-btn"
              aria-label={activeTab === 'chats' ? 'New chat' : 'New group'}
              title={activeTab === 'chats' ? 'New chat' : 'New group'}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex rounded-xl border border-[var(--border)] bg-[var(--surface-strong)] overflow-hidden">
          <button
            type="button"
            onClick={() => { setActiveTab('chats'); setActiveGroup(null); }}
            className={`
              flex-1 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors
              ${activeTab === 'chats'
                ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}
            `}
          >
            Chats
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('groups')}
            className={`
              flex-1 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors
              ${activeTab === 'groups'
                ? 'bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}
            `}
          >
            Groups
          </button>
        </div>

        <div className="mt-3">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                  d="M21 21l-4.3-4.3m1.8-5.2a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </span>
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={
                activeTab === 'chats'
                  ? (modeScopedChats.length > 0 ? 'Search...' : 'No chats yet')
                  : (groups.length > 0 ? 'Search groups...' : 'No groups yet')
              }
              disabled={activeTab === 'chats' ? modeScopedChats.length === 0 : groups.length === 0}
              aria-label={activeTab === 'chats' ? 'Search chats' : 'Search groups'}
              className="apple-input apple-input-icon disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-1">
          {activeTab === 'chats' ? (
            filtered.map((chat, i) => {
              const contact = contacts.find((c) => c.id === chat.contactId);
              if (!contact) return null;
              return (
                <div key={chat.id} className="animate-list-item-in" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                  <ChatRow
                    chat={chat}
                    contact={contact}
                    selected={selectedChatId === chat.id}
                    onClick={() => onSelectChat(chat.id)}
                    showHiddenControls={hiddenChatsEnabled}
                    onToggleHidden={toggleChatHidden}
                    searchHighlight={query || undefined}
                  />
                </div>
              );
            })
          ) : (
            filteredGroups.map((group, i) => (
              <div key={group.id} className="animate-list-item-in" style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}>
                <GroupRow
                  group={group}
                  selected={activeGroupId === group.id}
                  onClick={() => handleSelectGroup(group.id)}
                />
              </div>
            ))
          )}
        </div>
      </div>

      <Modal
        isOpen={showUnlockModal}
        onClose={() => setShowUnlockModal(false)}
        title="Hidden Chats"
      >
        <div className="space-y-4">
          <p className="text-[12px] text-[var(--text-secondary)]">
            Enter your hidden chats PIN to open hidden conversations.
          </p>
          <Input
            type="password"
            value={hiddenPin}
            onChange={(e) => {
              setHiddenPin(e.target.value);
              if (hiddenPinError) setHiddenPinError('');
            }}
            placeholder="Hidden chats PIN"
            aria-label="Hidden chats PIN"
            autoFocus
            error={hiddenPinError || undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                void unlockHiddenChats();
              }
            }}
          />
          <Button fullWidth onClick={() => void unlockHiddenChats()}>
            Unlock
          </Button>
        </div>
      </Modal>
    </div>
  );
}
