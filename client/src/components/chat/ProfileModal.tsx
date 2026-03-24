"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import {
  useContactsStore,
  useBlockedStore,
  type Chat,
} from "@/stores";
import type { Contact } from "@/crypto/storage";
import type { IdentityKeys } from "@/crypto/keys";
import { authApi } from "@/lib/api";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: Contact;
  chat: Chat;
  identityKeys: IdentityKeys | null;
  safetyNumber: string | null;
  isContactBlocked: boolean;
  onDeleteContact: () => void;
  onHideChat: () => void;
}

export default function ProfileModal({
  isOpen,
  onClose,
  contact,
  chat,
  identityKeys,
  safetyNumber,
  isContactBlocked,
  onDeleteContact,
  onHideChat,
}: ProfileModalProps) {
  const [copiedSafety, setCopiedSafety] = useState(false);
  const [showDeleteContact, setShowDeleteContact] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);

  const contactId = contact.id;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Contact Profile"
    >
      <div className="flex flex-col items-center pt-2 pb-6">
        <div className="w-24 h-24 bg-[var(--surface-strong)] rounded-full flex items-center justify-center text-[var(--text-primary)] text-4xl font-semibold mb-4 border border-[var(--border)]">
          {contact.username[0]!.toUpperCase()}
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
          {blockLoading ? 'Processing\u2026' : isContactBlocked ? 'Unblock Contact' : 'Block Contact'}
        </button>

        <button
          type="button"
          className="mt-4 w-full py-3 rounded-full border border-[var(--border)] text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] hover:bg-[var(--surface-alt)] transition-colors"
          onClick={onHideChat}
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
                onClick={onDeleteContact}
                className="flex-1 py-3 rounded-full border border-red-500/30 bg-red-500/20 text-red-400 text-[12px] font-semibold uppercase tracking-[0.08em] hover:bg-red-500/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
