"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  createAccountWithMnemonic,
  getMnemonicWords,
  getRandomWordPositions,
  verifyMnemonicWords,
} from "@/crypto/mnemonic";
import {
  saveIdentityKeys,
  saveSettings,
  loadSettings,
  savePreKeyMaterial,
  deriveMasterKeyFromPin,
  savePinHash,
} from "@/crypto/storage";
import { generatePreKeyBundle } from "@/crypto/keys";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores";
import type { IdentityKeys } from "@/crypto/keys";

type Step = "generate" | "backup" | "verify" | "username" | "pin" | "complete";

export default function SetupPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [step, setStep] = useState<Step>("generate");
  const [mnemonic, setMnemonic] = useState<string>("");
  const [identity, setIdentity] = useState<IdentityKeys | null>(null);
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [verifyPositions, setVerifyPositions] = useState<number[]>([]);
  const [verifyAnswers, setVerifyAnswers] = useState<string[]>(["", "", ""]);
  const [verifyError, setVerifyError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canProceed, setCanProceed] = useState(false);
  const usernameCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    if (step === "backup") {
      setCanProceed(false);
      const timer = setTimeout(() => setCanProceed(true), 3000);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [step]);

  useEffect(() => {
    async function generate() {
      const result = await createAccountWithMnemonic(128);
      setMnemonic(result.mnemonic);
      setIdentity(result.identity);
      setStep("backup");
    }

    generate();
  }, []);

  const handleCopyMnemonic = async () => {
    await navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Auto-clear clipboard after 15 seconds to prevent lingering mnemonic
    setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 15000);
  };

  const handleConfirmBackup = () => {
    const positions = getRandomWordPositions(
      getMnemonicWords(mnemonic).length,
      3,
    );
    setVerifyPositions(positions);
    setStep("verify");
  };

  const handleVerify = () => {
    const valid = verifyMnemonicWords(mnemonic, verifyPositions, verifyAnswers);
    if (valid) {
      setVerifyError("");
      setStep("username");
    } else {
      setVerifyError("Invalid words");
    }
  };

  const checkUsername = (value: string) => {
    const normalized = value.replace(/^@+/, "");
    setUsername(normalized);
    setUsernameError("");

    if (usernameCheckTimerRef.current) {
      clearTimeout(usernameCheckTimerRef.current);
      usernameCheckTimerRef.current = null;
    }

    if (normalized.length < 3) {
      setUsernameError("Minimum 3 characters");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(normalized)) {
      setUsernameError("Only letters, numbers and underscore");
      return;
    }

    usernameCheckTimerRef.current = setTimeout(async () => {
      const { data } = await authApi.checkUsername(normalized);
      if (data && !data.available) {
        setUsernameError("Username taken");
      }
    }, 400);
  };

  const handleSetPin = () => {
    if (pin.length < 4) {
      setPinError("Minimum 4 characters");
      return;
    }
    if (pin !== pinConfirm) {
      setPinError("PINs do not match");
      return;
    }

    setPinError("");
    void handleComplete();
  };

  const handleComplete = async () => {
    if (!identity) return;

    setLoading(true);
    try {
      const preKeyBundle = generatePreKeyBundle(
        identity.exchange,
        identity.signing,
        20,
      );

      const { data, error } = await authApi.register({
        username,
        identityKey: identity.signing.publicKey,
        exchangeIdentityKey: identity.exchange.publicKey,
        signedPrekey: preKeyBundle.signedPreKey.publicKey,
        signedPrekeySignature: preKeyBundle.signature,
        oneTimePrekeys: preKeyBundle.oneTimePreKeys.map((key, i) => ({
          id: `${username}-prekey-${i}`,
          publicKey: key.publicKey,
        })),
      });

      if (error) {
        throw new Error(error);
      }

      // Derive master key from PIN — PIN is only used here, never stored
      const masterKey = await deriveMasterKeyFromPin(pin);

      // Store signed prekey + OPKs locally (encrypted) so we can respond to X3DH and consume OPKs.
      await savePreKeyMaterial(
        {
          signedPreKey: preKeyBundle.signedPreKey,
          oneTimePreKeys: preKeyBundle.oneTimePreKeys,
          updatedAt: Date.now(),
        },
        masterKey,
      );

      await saveIdentityKeys(identity, masterKey);
      await savePinHash(pin);
      const existingSettings = await loadSettings();
      await saveSettings({
        ...existingSettings,
        username,
        userId: data!.id,
      });
      setAuth(data!.id, username, identity, masterKey);
      setMnemonic("");
      setStep("complete");

      setTimeout(() => {
        router.push("/chats");
      }, 1800);
    } catch (registrationError) {
      if (process.env.NODE_ENV !== 'production') console.error("Registration error:", registrationError);
      setUsernameError("Registration error");
    } finally {
      setLoading(false);
    }
  };

  const words = getMnemonicWords(mnemonic);
  const steps = ["backup", "verify", "username", "pin"] as const;
  const currentStepIndex = steps.indexOf(step as (typeof steps)[number]);

  return (
    <main className="auth-shell">
      <div className="w-full max-w-xl px-0">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-[0.28em] uppercase text-[var(--text-primary)]">
            L U M E
          </h1>
          <p className="auth-subtle mt-2">
            Secure registration with recovery phrase and PIN.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            <span className="lume-badge">Create account</span>
            <span className="lume-badge">Recovery phrase</span>
          </div>
        </div>

        <div className="auth-card lume-panel p-5 sm:p-8 animate-fade-in-scale">
          {step !== "generate" && step !== "complete" && (
            <div className="mb-8">
              <div className="h-1.5 bg-[var(--surface-alt)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent)] rounded-full transition-all duration-700"
                  style={{
                    width: `${((currentStepIndex + 1) / steps.length) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {step === "generate" && (
            <div className="text-center py-10" aria-busy="true">
              <div className="w-10 h-10 mx-auto mb-6 border-2 mono-spinner rounded-full animate-spin" />
              <p className="text-[var(--text-secondary)] text-sm">
                Generating keys...
              </p>
            </div>
          )}

          {step === "backup" && (
            <div>
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2 uppercase tracking-[0.04em]">
                  Recovery Phrase
                </h2>
                <p className="text-[var(--text-secondary)] text-sm">
                  Save this phrase offline. It cannot be restored by server.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-8">
                {words.map((word, index) => (
                  <div
                    key={word + index}
                    className="rounded-[16px] border border-[var(--border)] bg-[var(--surface-strong)] px-3 py-2 text-center shadow-[0_6px_14px_rgba(0,0,0,0.06)]"
                  >
                    <span className="text-[11px] text-[var(--text-muted)] mr-1">
                      {index + 1}.
                    </span>
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {word}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleCopyMnemonic}
                  className={`w-full apple-button-secondary ${copied ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : ""}`}
                >
                  {copied ? "Copied" : "Copy Phrase"}
                </button>
                <button
                  onClick={handleConfirmBackup}
                  disabled={!canProceed}
                  className="w-full apple-button disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  I saved the phrase
                </button>
              </div>
            </div>
          )}

          {step === "verify" && (
            <div>
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2 uppercase tracking-[0.04em]">
                  Verify Phrase
                </h2>
                <p className="text-[var(--text-secondary)] text-sm">
                  Type requested words to continue.
                </p>
              </div>

              <div className="space-y-5 mb-8">
                {verifyPositions.map((pos, index) => (
                  <div key={pos}>
                    <label htmlFor={`verify-word-${pos}`} className="block text-xs uppercase tracking-[0.08em] text-[var(--text-muted)] mb-2">
                      Word #{pos + 1}
                    </label>
                    <input
                      id={`verify-word-${pos}`}
                      type="text"
                      value={verifyAnswers[index]}
                      onChange={(e) => {
                        const newAnswers = [...verifyAnswers];
                        newAnswers[index] = e.target.value.toLowerCase();
                        setVerifyAnswers(newAnswers);
                      }}
                      placeholder="Type word"
                      className="apple-input"
                    />
                  </div>
                ))}
              </div>

              {verifyError && (
                <p className="text-sm text-[var(--text-secondary)] text-center mb-6">
                  {verifyError}
                </p>
              )}

              <div className="space-y-3">
                <button
                  onClick={handleVerify}
                  disabled={verifyAnswers.some((a) => !a)}
                  className="w-full apple-button disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setStep("backup")}
                  className="w-full apple-button-secondary"
                >
                  Show phrase again
                </button>
              </div>
            </div>
          )}

          {step === "username" && (
            <div>
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2 uppercase tracking-[0.04em]">
                  Username
                </h2>
                <p className="text-[var(--text-secondary)] text-sm">
                  Choose your public identifier.
                </p>
              </div>

              <div className="mb-8">
                <label htmlFor="setup-username" className="block apple-label mb-2">Username</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
                    @
                  </span>
                  <input
                    id="setup-username"
                    type="text"
                    value={username}
                    onChange={(e) => checkUsername(e.target.value)}
                    placeholder="username"
                    className="apple-input apple-input-icon"
                  />
                </div>
                {usernameError && (
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">
                    {usernameError}
                  </p>
                )}
              </div>

              <button
                onClick={() => setStep("pin")}
                disabled={!username || !!usernameError || username.length < 3}
                className="w-full apple-button disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          )}

          {step === "pin" && (
            <div>
              <div className="text-center mb-8">
                <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2 uppercase tracking-[0.04em]">
                  PIN Code
                </h2>
                <p className="text-[var(--text-secondary)] text-sm">
                  Protects access on this device.
                </p>
              </div>

              <div className="space-y-5 mb-8">
                <div>
                  <label htmlFor="setup-pin" className="block apple-label mb-2">PIN</label>
                  <input
                    id="setup-pin"
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="...."
                    className="apple-input text-center text-[20px] sm:text-[22px] tracking-[0.36em]"
                  />
                </div>
                <div>
                  <label htmlFor="setup-pin-confirm" className="block apple-label mb-2">Repeat PIN</label>
                  <input
                    id="setup-pin-confirm"
                    type="password"
                    value={pinConfirm}
                    onChange={(e) => setPinConfirm(e.target.value)}
                    placeholder="...."
                    className="apple-input text-center text-[20px] sm:text-[22px] tracking-[0.36em]"
                  />
                  {pinError && (
                    <p className="mt-3 text-sm text-[var(--text-secondary)] text-center">
                      {pinError}
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={handleSetPin}
                disabled={!pin || !pinConfirm || loading}
                className="w-full apple-button disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-5 h-5 border-2 mono-spinner rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  "Create Account"
                )}
              </button>
            </div>
          )}

          {step === "complete" && (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-5 rounded-full border border-[var(--border)] bg-[var(--accent)] text-[var(--accent-contrast)] flex items-center justify-center">
                <svg
                  className="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1 uppercase tracking-[0.04em]">
                Account Created
              </h2>
              <p className="text-[var(--text-secondary)] text-sm">
                @{username}
              </p>
            </div>
          )}
        </div>

        {(step === "backup" || step === "verify") && (
          <div className="mt-6 text-center">
            <button
              onClick={() => router.push("/")}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
