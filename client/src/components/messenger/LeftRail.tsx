'use client';

import React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore, useChatsStore, useUIStore } from '@/stores';
import ThemeToggle from '@/components/theme/ThemeToggle';

function NavTile({
  active,
  label,
  icon,
  onClick,
  disabled,
}: {
  active?: boolean;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`
        group w-full rounded-[18px] border border-[var(--border)]
        px-3 py-4 text-center transition-colors overflow-hidden
        ${active ? 'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[var(--shadow-sm)]' : 'bg-[var(--surface-strong)] hover:bg-[var(--surface-alt)] text-[var(--text-primary)]'}
        disabled:opacity-45 disabled:cursor-not-allowed
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]
      `}
    >
      <div className="flex flex-col items-center justify-center gap-2">
        <span
          className={`
            w-10 h-10 rounded-full border border-[var(--border)]
            inline-flex items-center justify-center transition-colors
            ${active ? 'bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)]' : 'bg-[var(--surface)] text-[var(--text-muted)]'}
          `}
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] leading-none">
          {label}
        </span>
      </div>
    </button>
  );
}

export default function LeftRail({ onPanic, onOpenBackup }: { onPanic?: () => void; onOpenBackup?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const username = useAuthStore((s) => s.username);
  const wsStatus = useUIStore((s) => s.wsStatus);
  const totalUnread = useChatsStore((s) => s.chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0));

  const initial = (username?.[0] || 'L').toUpperCase();
  const messengerActive = pathname.startsWith('/chat') || pathname.startsWith('/chats');
  const statusLabel = wsStatus === 'connected' ? 'Online' : wsStatus === 'connecting' ? 'Connecting' : 'Offline';
  const statusDotClass =
    wsStatus === 'connected'
      ? 'bg-[var(--accent)]'
      : wsStatus === 'connecting'
        ? 'bg-[var(--text-muted)]'
        : 'bg-[var(--surface-alt)] border border-[var(--border)]';

  return (
    <div className="lume-rail h-full min-h-0 rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden flex flex-col">
      <div className="px-6 pt-6 pb-5 border-b border-[var(--border)]/70">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push('/chats')}
            className="text-[12px] font-semibold uppercase tracking-[0.34em] text-[var(--text-primary)]"
            aria-label="L U M E"
            title="L U M E"
          >
            L U M E
          </button>
          <span className="lume-status-pill inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
            <span className={`w-2 h-2 rounded-full ${statusDotClass}`} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="px-6 py-6 flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <div className="w-24 h-24 rounded-full border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)] p-[3px]">
              <div className="lume-avatar w-full h-full rounded-full border border-[var(--border)] flex items-center justify-center text-[var(--text-primary)] text-[32px] font-semibold">
                {initial}
              </div>
            </div>
            {totalUnread > 0 ? (
              <span className="absolute -right-1 -top-1 w-7 h-7 rounded-full bg-[var(--accent)] text-[var(--accent-contrast)] text-[11px] font-semibold flex items-center justify-center border border-[var(--border)]">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            ) : null}
          </div>
          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">Profile</p>
            <p className="mt-1 text-[15px] font-semibold text-[var(--text-primary)]">{username ? `@${username}` : 'Guest'}</p>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3">
          <NavTile
            active={messengerActive}
            label="Messenger"
            onClick={() => router.push('/chats')}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M21 15a4 4 0 01-4 4H8l-5 3V7a4 4 0 014-4h10a4 4 0 014 4v8z" />
              </svg>
            }
          />
          <NavTile
            disabled
            label="Files"
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M7 3h7l3 3v15a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
              </svg>
            }
          />
          <NavTile
            active={pathname === '/settings'}
            label="Settings"
            onClick={() => router.push('/settings')}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            }
          />
          <NavTile
            label="Backup"
            onClick={onOpenBackup}
            icon={
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 12l7 7 7-7" />
              </svg>
            }
          />
        </div>
      </div>

      <div className="px-6 py-5 border-t border-[var(--border)]/70 flex items-center justify-between">
        {/* Theme toggle is available only on the start screen and in the profile panel after login. */}
        <ThemeToggle size="sm" />
        <button
          type="button"
          onClick={onPanic}
          className="w-9 h-9 inline-flex items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-alt)] transition-colors"
          aria-label="Wipe local data"
          title="Wipe local data"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 9v3" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 16h.01" />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
              d="M10.3 3.4a2 2 0 013.4 0l8.2 14.2A2 2 0 0120.2 21H3.8a2 2 0 01-1.7-3.4l8.2-14.2z"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
