/**
 * Settings — Privacy section:
 * self-destruct timer, hidden chats toggle, hidden PIN modals.
 */

"use client";

import { useState, useCallback } from "react";
import { Button, Input, Modal } from "@/components/ui";
import type { Settings } from "@/crypto/storage";
import {
  hashHiddenChatPin,
  saveSettings,
  verifyHiddenChatPin,
  deriveMasterKeyFromPin,
} from "@/crypto/storage";
import { useChatsStore, useUIStore } from "@/stores";
import { SectionHeading, ChipSelector, ToggleRow } from "./shared";

const SELF_DESTRUCT_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Off", value: null },
  { label: "5 s", value: 5 },
  { label: "30 s", value: 30 },
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "1 hr", value: 3600 },
];

type HiddenPinMode = "setup" | "change" | "reset";

interface PrivacySectionProps {
  settings: Settings;
  /** The derived master key — used to verify account PIN for hidden PIN reset. Never the raw PIN. */
  masterKey: Uint8Array | null;
  onSettingsChange: (next: Settings) => void;
  onUpdate: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onSaveFlash: () => void;
}

export default function PrivacySection({
  settings,
  masterKey,
  onSettingsChange,
  onUpdate,
  onSaveFlash,
}: PrivacySectionProps) {
  const setChats = useChatsStore((s) => s.setChats);
  const setShowHiddenChats = useUIStore((s) => s.setShowHiddenChats);

  const [showHiddenPinModal, setShowHiddenPinModal] = useState(false);
  const [hiddenPinMode, setHiddenPinMode] = useState<HiddenPinMode>("setup");
  const [hiddenCurrentPin, setHiddenCurrentPin] = useState("");
  const [hiddenAccountPin, setHiddenAccountPin] = useState("");
  const [hiddenPin, setHiddenPin] = useState("");
  const [hiddenPinConfirm, setHiddenPinConfirm] = useState("");
  const [hiddenPinError, setHiddenPinError] = useState<string | null>(null);

  const resetHiddenPinForm = useCallback(() => {
    setHiddenCurrentPin("");
    setHiddenAccountPin("");
    setHiddenPin("");
    setHiddenPinConfirm("");
    setHiddenPinError(null);
  }, []);

  const openHiddenPinModal = useCallback(
    (mode: HiddenPinMode) => {
      setHiddenPinMode(mode);
      resetHiddenPinForm();
      setShowHiddenPinModal(true);
    },
    [resetHiddenPinForm],
  );

  const handleSubmitHiddenPin = async () => {
    setHiddenPinError(null);

    if (hiddenPin.length < 4) {
      setHiddenPinError("PIN must be at least 4 characters");
      return;
    }
    if (hiddenPin !== hiddenPinConfirm) {
      setHiddenPinError("PINs do not match");
      return;
    }

    try {
      if (hiddenPinMode === "change") {
        if (!settings.hiddenChatPinHash) {
          setHiddenPinError("Hidden chats PIN is not configured");
          return;
        }
        if (hiddenCurrentPin.length < 4) {
          setHiddenPinError("Enter current hidden chats PIN");
          return;
        }
        const ok = await verifyHiddenChatPin(
          hiddenCurrentPin,
          settings.hiddenChatPinHash,
        );
        if (!ok) {
          setHiddenPinError("Current hidden chats PIN is incorrect");
          return;
        }
      }

      if (hiddenPinMode === "reset") {
        if (!masterKey) {
          setHiddenPinError("Unlock session required");
          return;
        }
        // Verify the entered account PIN by deriving a key and comparing with session key
        const derivedKey = await deriveMasterKeyFromPin(hiddenAccountPin);
        // Constant-time comparison
        if (derivedKey.length !== masterKey.length) {
          setHiddenPinError("Account PIN is incorrect");
          return;
        }
        let diff = 0;
        for (let i = 0; i < derivedKey.length; i++) {
          diff |= derivedKey[i]! ^ masterKey[i]!;
        }
        if (diff !== 0) {
          setHiddenPinError("Account PIN is incorrect");
          return;
        }
      }

      const hiddenChatPinHash = await hashHiddenChatPin(hiddenPin);
      const next: Settings = {
        ...settings,
        hiddenChatsEnabled: true,
        hiddenChatPinHash,
      };
      onSettingsChange(next);
      if (!masterKey) {
        setHiddenPinError("Unlock session required to save hidden PIN");
        return;
      }
      await saveSettings(next, masterKey);
      setShowHiddenPinModal(false);
      resetHiddenPinForm();
      onSaveFlash();
    } catch {
      setHiddenPinError("Failed to save hidden chats PIN");
    }
  };

  const handleToggleHiddenChats = (enabled: boolean) => {
    if (!enabled) {
      setShowHiddenChats(false);
      const visibleChats = useChatsStore
        .getState()
        .chats.map((chat) => (chat.isHidden ? { ...chat, isHidden: false } : chat));
      setChats(visibleChats);
      void onUpdate("hiddenChatsEnabled", false);
      return;
    }

    if (settings.hiddenChatPinHash) {
      void onUpdate("hiddenChatsEnabled", true);
      return;
    }

    openHiddenPinModal("setup");
  };

  return (
    <>
      <section>
        <SectionHeading>Privacy</SectionHeading>

        <div className="mb-4">
          <p className="text-[13px] text-[var(--text-secondary)] mb-3">
            Self-destruct default
          </p>
          <ChipSelector<number | null>
            options={SELF_DESTRUCT_OPTIONS}
            value={settings.selfDestructDefault}
            onChange={(v) => onUpdate("selfDestructDefault", v)}
          />
        </div>

        <ToggleRow
          label="Hidden Chats"
          description="Enable a separate hidden chat list protected by PIN"
          checked={settings.hiddenChatsEnabled}
          onChange={handleToggleHiddenChats}
        />

        {settings.hiddenChatsEnabled ? (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => openHiddenPinModal("change")}
              className="flex-1 apple-button-secondary text-[12px]"
            >
              Change Hidden PIN
            </button>
            <button
              type="button"
              onClick={() => openHiddenPinModal("reset")}
              className="flex-1 apple-button-secondary text-[12px]"
            >
              Reset Hidden PIN
            </button>
          </div>
        ) : null}
      </section>

      <Modal
        isOpen={showHiddenPinModal}
        onClose={() => {
          setShowHiddenPinModal(false);
          resetHiddenPinForm();
        }}
        title={
          hiddenPinMode === "setup"
            ? "Hidden Chats PIN"
            : hiddenPinMode === "change"
              ? "Change Hidden PIN"
              : "Reset Hidden PIN"
        }
      >
        <div className="space-y-4">
          <p className="text-[12px] text-[var(--text-secondary)]">
            {hiddenPinMode === "setup"
              ? "Create a separate PIN for opening hidden chats."
              : hiddenPinMode === "change"
                ? "Enter current hidden PIN and set a new one."
                : "Reset hidden PIN using your account PIN and set a new hidden PIN."}
          </p>

          {hiddenPinMode === "change" ? (
            <Input
              type="password"
              placeholder="Current hidden PIN"
              aria-label="Current hidden PIN"
              value={hiddenCurrentPin}
              onChange={(e) => setHiddenCurrentPin(e.target.value)}
              autoFocus
            />
          ) : null}

          {hiddenPinMode === "reset" ? (
            <Input
              type="password"
              placeholder="Account PIN"
              aria-label="Account PIN"
              value={hiddenAccountPin}
              onChange={(e) => setHiddenAccountPin(e.target.value)}
              autoFocus
            />
          ) : null}

          <Input
            type="password"
            placeholder="New hidden PIN"
            aria-label="New hidden PIN"
            value={hiddenPin}
            onChange={(e) => setHiddenPin(e.target.value)}
            autoFocus={hiddenPinMode === "setup"}
          />
          <Input
            type="password"
            placeholder="Confirm new hidden PIN"
            aria-label="Confirm new hidden PIN"
            value={hiddenPinConfirm}
            onChange={(e) => setHiddenPinConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSubmitHiddenPin()}
          />

          {hiddenPinError ? (
            <p className="text-[12px] text-red-500 text-center">{hiddenPinError}</p>
          ) : null}

          <Button
            onClick={() => void handleSubmitHiddenPin()}
            disabled={!hiddenPin || !hiddenPinConfirm}
            className="w-full"
          >
            {hiddenPinMode === "setup"
              ? "Enable Hidden Chats"
              : hiddenPinMode === "change"
                ? "Change Hidden PIN"
                : "Reset Hidden PIN"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
