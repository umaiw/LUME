"use client";

import type { Contact } from "@/crypto/storage";
import { Avatar } from "@/components/ui";
import { formatTimerLabel, TIMER_OPTIONS } from "./chatUtils";

interface ChatHeaderProps {
  contact: Contact;
  avatarUrl?: string | null;
  isTyping: boolean;
  selfDestructTime: number | null;
  showOptions: boolean;
  onBack: () => void;
  onOpenProfile: () => void;
  onToggleOptions: () => void;
  onSelectTimer: (value: number | null) => void;
}

export default function ChatHeader({
  contact,
  avatarUrl,
  isTyping,
  selfDestructTime,
  showOptions,
  onBack,
  onOpenProfile,
  onToggleOptions,
  onSelectTimer,
}: ChatHeaderProps) {
  return (
    <header className="px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-[var(--border)]/70">
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
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
            onClick={onOpenProfile}
            className="flex items-center gap-3 min-w-0 hover:bg-[var(--surface-alt)] rounded-[18px] px-2 py-1.5 transition-colors"
          >
            <div className="w-11 h-11 rounded-full border border-[var(--border)] flex-shrink-0 overflow-hidden">
              <Avatar src={avatarUrl} username={contact.username} size="lg" />
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
                    Auto-delete {formatTimerLabel(selfDestructTime)}
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onToggleOptions}
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
        <div className="mt-4 flex items-center gap-2 flex-wrap animate-fade-in-up">
          <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
            Auto-delete
          </span>
          {TIMER_OPTIONS.map((opt) => (
            <button
              key={opt.value ?? "off"}
              type="button"
              onClick={() => onSelectTimer(opt.value)}
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
  );
}
