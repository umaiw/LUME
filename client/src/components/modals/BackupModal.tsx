"use client";

import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { exportEncryptedBackup, importEncryptedBackup } from "@/crypto/storage";
import { reconcileRestoreConsistency } from "@/lib/settingsConsistency";

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  masterKey: Uint8Array | null;
}

export default function BackupModal({
  isOpen,
  onClose,
  masterKey,
}: BackupModalProps) {
  const [backupOutput, setBackupOutput] = useState("");
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [importInput, setImportInput] = useState("");
  const [backupPin, setBackupPin] = useState("");

  return (
    <Modal isOpen={isOpen} onClose={() => {
      setBackupOutput("");
      setImportInput("");
      setBackupPin("");
      setBackupStatus(null);
      onClose();
    }} title="Backup & Restore">
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
              if (process.env.NODE_ENV !== 'production') console.error('Backup export error:', e);
              setBackupStatus("Backup failed. Check your PIN and try again.");
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
                await reconcileRestoreConsistency();
                setBackupStatus("Backup restored. Restart the application.");
              } catch (e) {
                if (process.env.NODE_ENV !== 'production') console.error('Backup restore error:', e);
                setBackupStatus("Restore failed. Check your data and PIN.");
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
  );
}
