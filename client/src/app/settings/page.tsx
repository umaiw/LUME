/**
 * Settings page — theme, notifications, self-destruct, hidden chats, change PIN.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, SettingsSkeleton } from "@/components/ui";
import MessengerShell from "@/components/messenger/MessengerShell";
import LeftRail from "@/components/messenger/LeftRail";
import { useMessengerSync } from "@/hooks/useMessengerSync";
import { usePanic } from "@/hooks/usePanic";
import { useAuthStore } from "@/stores";
import { authApi } from "@/lib/api";
import {
  loadSettings,
  saveSettings,
  changePin,
  panicWipe,
  type Settings,
} from "@/crypto/storage";
import { applyTheme } from "@/lib/theme";

/* ──────────── Self-destruct timer options ──────────── */
const SELF_DESTRUCT_OPTIONS: { label: string; value: number | null }[] = [
  { label: "Off", value: null },
  { label: "5 s", value: 5 },
  { label: "30 s", value: 30 },
  { label: "1 min", value: 60 },
  { label: "5 min", value: 300 },
  { label: "1 hr", value: 3600 },
];

/* ──────────── Reusable section heading ──────────── */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)] mb-4">
      {children}
    </h2>
  );
}

/* ──────────── Toggle row ──────────── */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-3 cursor-pointer select-none">
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">
          {label}
        </p>
        {description && (
          <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`
          relative w-11 h-6 rounded-full border transition-colors shrink-0
          ${
            checked
              ? "bg-[var(--accent)] border-[var(--accent)]"
              : "bg-[var(--surface-alt)] border-[var(--border)]"
          }
        `}
      >
        <span
          className={`
            absolute top-0.5 left-0.5 w-5 h-5 rounded-full transition-transform
            ${
              checked
                ? "translate-x-5 bg-[var(--accent-contrast)]"
                : "translate-x-0 bg-[var(--text-muted)]"
            }
          `}
        />
      </button>
    </label>
  );
}

/* ──────────── Chip selector (for theme / self-destruct) ──────────── */
function ChipSelector<T extends string | number | null>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`
              px-4 py-2 rounded-full text-[13px] font-medium border transition-colors
              ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-contrast)] border-[var(--accent)]"
                  : "bg-[var(--surface)] text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--surface-alt)]"
              }
            `}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ════════════════════════════ Main Page ════════════════════════════ */

export default function SettingsPage() {
  const router = useRouter();
  const { hydrated } = useMessengerSync();
  const { isAuthenticated } = useAuthStore();
  const { isPanicMode, showPanicConfirm, setShowPanicConfirm, executePanic } =
    usePanic();

  /* ── settings state ── */
  const [settings, setSettingsState] = useState<Settings | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);

  /* ── change PIN modal ── */
  const [showPinModal, setShowPinModal] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinSuccess, setPinSuccess] = useState(false);
  const [backupWarning, setBackupWarning] = useState(false);

  /* ── delete account modal ── */
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);

  /* ── auth guard ── */
  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.push("/");
    }
  }, [hydrated, isAuthenticated, router]);

  /* ── load settings ── */
  useEffect(() => {
    if (hydrated && isAuthenticated) {
      loadSettings().then(setSettingsState);
    }
  }, [hydrated, isAuthenticated]);

  /* ── persist helper ── */
  const updateSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (!settings) return;
      const next = { ...settings, [key]: value };
      setSettingsState(next);
      // Apply theme change immediately via shared utility (skip persist — we save below)
      if (key === "theme") {
        applyTheme(value as Settings["theme"], true);
      }

      await saveSettings(next);
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1200);
    },
    [settings],
  );

  /* ── change PIN handler ── */
  const handleChangePin = async () => {
    setPinError(null);

    if (newPin.length < 4) {
      setPinError("New PIN must be at least 4 characters");
      return;
    }
    if (newPin !== confirmPin) {
      setPinError("PINs do not match");
      return;
    }
    if (newPin === currentPin) {
      setPinError("New PIN must be different from the current one");
      return;
    }

    setPinLoading(true);
    try {
      await changePin(currentPin, newPin);
      // Update in-memory PIN
      useAuthStore.getState().setPin(newPin);
      setPinSuccess(true);
      setBackupWarning(true);
      setTimeout(() => {
        setShowPinModal(false);
        setPinSuccess(false);
        setCurrentPin("");
        setNewPin("");
        setConfirmPin("");
      }, 1500);
    } catch {
      setPinError("Current PIN is incorrect");
    } finally {
      setPinLoading(false);
    }
  };

  /* ── delete account handler ── */
  const handleDeleteAccount = async () => {
    // Delete on server first (best-effort — wipe locally regardless)
    const keys = useAuthStore.getState().identityKeys;
    const uid = useAuthStore.getState().userId;
    if (keys && uid) {
      try {
        await authApi.deleteAccount(uid, keys);
      } catch {
        // Server unreachable — still wipe locally
      }
    }

    await panicWipe();
    useAuthStore.getState().clearAuth();
    router.push("/");
  };

  /* ── loading / guard ── */
  if (!hydrated || !settings) {
    return (
      <MessengerShell
        leftRail={<div className="h-full" />}
        chatList={<SettingsSkeleton />}
        main={
          <div className="lume-panel h-full rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] flex items-center justify-center">
            <div className="w-8 h-8 border-2 mono-spinner rounded-full animate-spin" />
          </div>
        }
      />
    );
  }

  if (!isAuthenticated) return null;

  if (isPanicMode) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[var(--text-secondary)] uppercase tracking-[0.18em] text-sm">
          No messages
        </p>
      </div>
    );
  }

  /* ════════════════════════════ Render ════════════════════════════ */

  const settingsContent = (
    <div className="lume-panel h-full rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] overflow-hidden flex flex-col">
      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-5 border-b border-[var(--border)]/70 flex items-center justify-between">
        <h1 className="text-[12px] font-semibold uppercase tracking-[0.34em] text-[var(--text-primary)]">
          Settings
        </h1>
        {saveFlash && (
          <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] animate-pulse">
            Saved
          </span>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-8">
        {/* ─── Appearance ─── */}
        <section>
          <SectionHeading>Appearance</SectionHeading>
          <p className="text-[13px] text-[var(--text-secondary)] mb-3">
            Theme
          </p>
          <ChipSelector<"light" | "dark" | "system">
            options={[
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
              { label: "System", value: "system" },
            ]}
            value={settings.theme}
            onChange={(v) => updateSetting("theme", v)}
          />
        </section>

        {/* ─── Notifications ─── */}
        <section>
          <SectionHeading>Notifications</SectionHeading>
          <ToggleRow
            label="Desktop Notifications"
            description="Show a notification when a new message arrives"
            checked={settings.notifications}
            onChange={(v) => updateSetting("notifications", v)}
          />
        </section>

        {/* ─── Privacy ─── */}
        <section>
          <SectionHeading>Privacy</SectionHeading>

          <div className="mb-4">
            <p className="text-[13px] text-[var(--text-secondary)] mb-3">
              Self-destruct default
            </p>
            <ChipSelector<number | null>
              options={SELF_DESTRUCT_OPTIONS}
              value={settings.selfDestructDefault}
              onChange={(v) => updateSetting("selfDestructDefault", v)}
            />
          </div>

          <ToggleRow
            label="Hidden Chats"
            description="Enable a separate hidden chat list protected by PIN"
            checked={settings.hiddenChatsEnabled}
            onChange={(v) => updateSetting("hiddenChatsEnabled", v)}
          />
        </section>

        {/* ─── Security ─── */}
        <section>
          <SectionHeading>Security</SectionHeading>

          {backupWarning && (
            <div className="mb-4 p-3 rounded-[var(--radius-md)] border border-[var(--text-muted)]/30 bg-[var(--surface-alt)]">
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                <span className="font-semibold">PIN changed.</span> Old backups are
                encrypted with the previous PIN. Create a new backup to use the
                current PIN.
              </p>
              <button
                type="button"
                onClick={() => setBackupWarning(false)}
                className="mt-2 text-[11px] uppercase tracking-[0.1em] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              setShowPinModal(true);
              setPinError(null);
              setPinSuccess(false);
              setCurrentPin("");
              setNewPin("");
              setConfirmPin("");
            }}
            className="apple-button-secondary w-full text-center"
          >
            Change PIN
          </button>
        </section>

        {/* ─── Danger Zone ─── */}
        <section>
          <SectionHeading>Danger Zone</SectionHeading>

          <button
            type="button"
            onClick={() => setShowDeleteAccount(true)}
            className="w-full py-3 px-4 rounded-[var(--radius-md)] border border-red-500/30 text-red-500 text-[13px] font-semibold uppercase tracking-[0.1em] hover:bg-red-500/5 transition-colors"
          >
            Delete Account & Wipe Data
          </button>
        </section>
      </div>

      {/* ── Change PIN Modal ── */}
      <Modal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        title="Change PIN"
      >
        <div className="space-y-4">
          {pinSuccess ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto rounded-full bg-[var(--accent)] flex items-center justify-center mb-3">
                <svg
                  className="w-6 h-6 text-[var(--accent-contrast)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <p className="text-[14px] font-medium text-[var(--text-primary)]">
                PIN changed successfully
              </p>
            </div>
          ) : (
            <>
              <Input
                type="password"
                placeholder="Current PIN"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                autoFocus
              />
              <Input
                type="password"
                placeholder="New PIN"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value)}
              />
              <Input
                type="password"
                placeholder="Confirm New PIN"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChangePin()}
              />
              {pinError && (
                <p className="text-[12px] text-red-500 text-center">
                  {pinError}
                </p>
              )}
              <Button
                onClick={handleChangePin}
                disabled={
                  pinLoading || !currentPin || !newPin || !confirmPin
                }
                className="w-full"
              >
                {pinLoading ? "Changing…" : "Change PIN"}
              </Button>
            </>
          )}
        </div>
      </Modal>

      {/* ── Delete Account Modal ── */}
      <Modal
        isOpen={showDeleteAccount}
        onClose={() => setShowDeleteAccount(false)}
        title="Delete Account"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--text-secondary)] text-center">
            This will permanently erase all local data including keys,
            contacts, and messages. This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowDeleteAccount(false)}
              className="apple-button-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteAccount}
              className="flex-1 py-3 px-4 rounded-[var(--radius-md)] bg-red-500 text-white text-[13px] font-semibold uppercase tracking-[0.1em] hover:bg-red-600 transition-colors"
            >
              Delete Everything
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Panic Modal ── */}
      <Modal
        isOpen={showPanicConfirm}
        onClose={() => setShowPanicConfirm(false)}
        title="WIPE ALL DATA"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[var(--text-secondary)] text-center">
            All local data will be permanently erased. This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setShowPanicConfirm(false)}
              className="apple-button-secondary flex-1"
            >
              Cancel
            </button>
            <Button onClick={executePanic} className="flex-1">
              Confirm Wipe
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );

  return (
    <MessengerShell
      leftRail={
        <LeftRail
          onPanic={() => setShowPanicConfirm(true)}
        />
      }
      chatList={settingsContent}
      main={
        <div className="lume-panel h-full rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-sm)] flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto rounded-full border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center mb-4">
              <svg
                className="w-7 h-7 text-[var(--text-muted)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
              >
                <circle cx="12" cy="12" r="3" strokeWidth="1.8" />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                  d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
                />
              </svg>
            </div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
              Manage your preferences
            </p>
          </div>
        </div>
      }
      rightRail={undefined}
    />
  );
}
