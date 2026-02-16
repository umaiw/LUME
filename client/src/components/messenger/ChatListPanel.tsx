'use client';

import React from 'react';
import type { Chat } from '@/stores';
import { useBlockedStore } from '@/stores';
import type { Contact } from '@/crypto/storage';

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
}: {
  chat: Chat;
  contact: Contact;
  selected: boolean;
  onClick: () => void;
}) {
  const timeLabel = formatTime(chat.lastMessage?.timestamp);
  const isBlocked = useBlockedStore((s) => !!s.blockedIds[contact.id]);
  const preview = isBlocked ? 'Blocked' : (chat.lastMessage?.content || 'Start messaging');

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        relative w-full px-4 py-3 text-left transition-colors
        border-b border-[var(--border)]/55 last:border-b-0
        ${selected ? 'bg-[var(--surface-strong)] text-[var(--text-primary)]' : 'hover:bg-[var(--surface-alt)] text-[var(--text-primary)]'}
      `}
    >
      {selected ? <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accent)]" aria-hidden="true" /> : null}
      <div className="flex items-center gap-3">
        <div
          className={`
            w-11 h-11 rounded-full border flex items-center justify-center font-semibold flex-shrink-0
            shadow-[var(--shadow-sm)]
            ${selected ? 'border-[var(--accent)]/35 bg-[var(--surface)]' : 'border-[var(--border)] bg-[var(--surface)]'}
          `}
        >
          {contact.username[0].toUpperCase()}
        </div>

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

export default function ChatListPanel({
  chats,
  contacts,
  selectedChatId,
  searchQuery,
  onSearchChange,
  onSelectChat,
  onNewChat,
}: {
  chats: Chat[];
  contacts: Contact[];
  selectedChatId: string | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
}) {
  const filtered = chats
    .filter((chat) => !chat.isHidden)
    .filter((chat) => {
      const contact = contacts.find((c) => c.id === chat.contactId);
      if (!contact) return false;
      if (!searchQuery.trim()) return true;
      return contact.username.toLowerCase().includes(searchQuery.toLowerCase());
    });

  return (
    <div className="lume-panel h-full min-h-0 rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-[var(--border)]/70">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)]">
              Messages
            </h2>
          </div>
          <button
            type="button"
            onClick={onNewChat}
            className="lume-icon-btn"
            aria-label="New chat"
            title="New chat"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 12h14" />
            </svg>
          </button>
        </div>

        <div className="mt-4">
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
              placeholder={chats.length > 0 ? 'Search...' : 'No chats yet'}
              disabled={chats.length === 0}
              className="apple-input apple-input-icon disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-1">
          {filtered.map((chat) => {
            const contact = contacts.find((c) => c.id === chat.contactId);
            if (!contact) return null;
            return (
              <ChatRow
                key={chat.id}
                chat={chat}
                contact={contact}
                selected={selectedChatId === chat.id}
                onClick={() => onSelectChat(chat.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
