'use client';

import React from 'react';
import type { Chat } from '@/stores';
import type { Contact } from '@/crypto/storage';

function AvatarButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        w-12 h-12 rounded-full border flex items-center justify-center font-semibold transition-colors
        bg-[var(--surface)] text-[var(--text-primary)] border-[var(--border)]
        hover:bg-[var(--surface-alt)] shadow-[var(--shadow-sm)]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
        ${active ? 'ring-2 ring-[var(--accent)]' : ''}
      `}
      title={label}
      aria-label={label}
    >
      {label[0]!.toUpperCase()}
    </button>
  );
}

export default function RightRail({
  contacts,
  chats,
  activeChatId,
  onOpenContact,
}: {
  contacts: Contact[];
  chats: Chat[];
  activeChatId: string | null;
  onOpenContact: (contactId: string) => void;
}) {
  const contactOrder = [...contacts].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));

  const activeContactId = activeChatId
    ? chats.find((c) => c.id === activeChatId)?.contactId ?? null
    : null;

  return (
    <div className="lume-panel h-full min-h-0 rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden">
      <div className="h-full flex flex-col items-center px-3 py-4">
        <div className="flex-1 min-h-0 overflow-y-auto w-full flex flex-col items-center gap-3">
          {contactOrder.map((c) => (
            <AvatarButton
              key={c.id}
              label={c.username}
              active={activeContactId === c.id}
              onClick={() => onOpenContact(c.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
