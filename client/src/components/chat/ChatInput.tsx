"use client";

import type { Message } from "@/stores";
import type { Contact } from "@/crypto/storage";
import { formatTimerLabel } from "./chatUtils";

interface ChatInputProps {
  messageText: string;
  sending: boolean;
  selfDestructTime: number | null;
  replyingTo: Message | null;
  userId: string | null;
  contact: Contact | undefined;
  onMessageChange: (text: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onToggleOptions: () => void;
  onCancelReply: () => void;
}

export default function ChatInput({
  messageText,
  sending,
  selfDestructTime,
  replyingTo,
  userId,
  contact,
  onMessageChange,
  onSend,
  onKeyDown,
  onToggleOptions,
  onCancelReply,
}: ChatInputProps) {
  return (
    <footer className="px-3 sm:px-5 md:px-6 py-3 sm:py-4 border-t border-[var(--border)]/70">
      {/* Reply bar */}
      {replyingTo && (
        <div className="mb-3 flex items-start gap-3 px-4 py-2.5 rounded-[var(--radius-md)] bg-[var(--surface-alt)] border border-[var(--border)]">
          <div className="flex-1 min-w-0 pl-3 border-l-2 border-[var(--accent)]">
            <p className="text-[11px] font-semibold text-[var(--accent)] uppercase tracking-[0.06em] mb-0.5">
              {replyingTo.senderId === userId ? 'You' : (contact?.username || 'Unknown')}
            </p>
            <p className="text-[12px] text-[var(--text-secondary)] truncate">
              {replyingTo.content.length > 100 ? replyingTo.content.slice(0, 100) + '\u2026' : replyingTo.content}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
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
            onChange={(e) => onMessageChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type message..."
            rows={1}
            maxLength={10000}
            aria-label="Message input"
            className="w-full px-4 py-3 bg-[var(--surface-strong)] rounded-full border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--focus-ring)] resize-none shadow-[var(--shadow-sm)] text-[16px] leading-snug"
            style={{ minHeight: "48px", maxHeight: "140px" }}
          />
        </div>
        <button
          type="button"
          onClick={onToggleOptions}
          className={`w-10 h-10 rounded-full border transition-colors inline-flex items-center justify-center flex-shrink-0 ${
            selfDestructTime
              ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--accent)]"
              : "bg-[var(--surface-strong)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
          aria-label="Self-destruct timer"
          title={selfDestructTime ? `Auto-delete: ${formatTimerLabel(selfDestructTime)}` : "Self-destruct timer"}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v5l3 2" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onSend}
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
            Auto-delete in {formatTimerLabel(selfDestructTime)}
          </span>
        </div>
      ) : null}
    </footer>
  );
}
