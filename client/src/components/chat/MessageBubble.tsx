"use client";

import { useEffect, useState, memo } from "react";
import type { Message } from "@/stores";
import { formatCountdown } from "./chatUtils";

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

  useEffect(() => {
    if (remaining !== null && remaining <= 0 && message.selfDestructAt) {
      onDelete(message.id);
    }
  }, [remaining, message.id, message.selfDestructAt, onDelete]);

  return (
    <div className={`group flex ${isMine ? "justify-end" : "justify-start"}`}>
      {/* Action buttons — left of own messages */}
      {isMine && (
        <div className="self-center mr-2 flex items-center gap-1 opacity-0 group-hover:opacity-60 transition-opacity">
          <button
            type="button"
            onClick={() => onReply(message)}
            className="hover:!opacity-100 p-1"
            aria-label="Reply"
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
            aria-label="Delete message"
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
                {message.replyTo.content.length > 80 ? message.replyTo.content.slice(0, 80) + '\u2026' : message.replyTo.content}
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
            aria-label="Reply"
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
            aria-label="Delete message"
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

export const MessageBubbleMemo = memo(
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

export default MessageBubble;
