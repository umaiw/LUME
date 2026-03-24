"use client";

import { Modal, Button, Input } from "@/components/ui";

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  username: string;
  onUsernameChange: (value: string) => void;
  error: string;
  loading: boolean;
  onSubmit: () => void;
}

export default function AddContactModal({
  isOpen,
  onClose,
  username,
  onUsernameChange,
  error,
  loading,
  onSubmit,
}: AddContactModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start Chat">
      <div className="space-y-4">
        <Input
          label="Recipient Username"
          value={username}
          onChange={(e) => onUsernameChange(e.target.value.replace(/^@+/, "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32))}
          placeholder="username"
          error={error}
          icon={<span className="text-[var(--text-muted)]">@</span>}
        />
        <Button
          fullWidth
          onClick={onSubmit}
          loading={loading}
          disabled={!username}
        >
          Start
        </Button>
      </div>
    </Modal>
  );
}
