"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  loadIdentityKeys,
  loadSettings,
  saveSettings,
  hasAccount,
  loadPreKeyMaterial,
  savePreKeyMaterial,
  deriveMasterKeyFromPin,
  savePinHash,
  checkPinLockout,
  recordPinFailure,
  resetPinFailures,
} from "@/crypto/storage";
import { useAuthStore } from "@/stores";
import { authApi } from "@/lib/api";
import { generatePreKeyBundle } from "@/crypto/keys";
import { checkAndRotateSpk, backfillSpkCreatedAt } from "@/crypto/spkRotation";

export default function UnlockPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [showReRegisterWarning, setShowReRegisterWarning] = useState(false);
  const [pendingIdentity, setPendingIdentity] = useState<Awaited<
    ReturnType<typeof loadIdentityKeys>
  > | null>(null);

  useEffect(() => {
    async function check() {
      const exists = await hasAccount();
      if (!exists) {
        router.push("/");
      }
    }

    check();
  }, [router]);

  const handleUnlock = async () => {
    setError("");
    setLoading(true);

    try {
      // Check persistent lockout before attempting
      await checkPinLockout();

      // Derive the master key from the entered PIN — PIN is discarded after this
      const masterKey = await deriveMasterKeyFromPin(pin);
      const identity = await loadIdentityKeys(masterKey, pin);

      if (!identity) {
        await recordPinFailure();
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        if (nextAttempts >= 5) {
          setError("Too many attempts");
          return;
        }
        setError("Invalid PIN");
        return;
      }

      await resetPinFailures();

      const settings = await loadSettings();
      let resolvedUserId = settings.userId;
      let resolvedUsername = settings.username?.replace(/^@+/, "").trim();

      // Always try to reconcile stored userId with the server's current record.
      // This prevents "User not found" loops after DB resets or stale local settings.
      if (resolvedUsername) {
        const { data: serverUser, error: serverError } =
          await authApi.getUser(resolvedUsername, identity);

        if (serverUser) {
          if (serverUser.identityKey !== identity.signing.publicKey) {
            setError(
              "This username belongs to a different identity on the server.",
            );
            return;
          }

          resolvedUserId = serverUser.id;
          resolvedUsername = serverUser.username;

          if (
            resolvedUserId !== settings.userId ||
            resolvedUsername !== settings.username
          ) {
            await saveSettings({
              ...settings,
              userId: resolvedUserId,
              username: resolvedUsername,
            });
          }
        } else if (serverError === "User not found") {
          // Server DB was reset or the account was deleted.
          // Show a warning before re-registering — existing contacts won't be able to decrypt old messages.
          setPendingIdentity(identity);
          setShowReRegisterWarning(true);
          return;
        }
      }

      if (!resolvedUserId || !resolvedUsername) {
        setError("Profile missing. Recover account with phrase.");
        return;
      }

      // Backfill spkCreatedAt for prekey material created before rotation feature
      const existingMaterial = await loadPreKeyMaterial(masterKey);
      if (existingMaterial) {
        const backfilled = backfillSpkCreatedAt(existingMaterial);
        if (backfilled !== existingMaterial) {
          await savePreKeyMaterial(backfilled, masterKey);
        }
      }

      // Rotate SPK only if older than the rotation interval (7 days)
      const spkResult = await checkAndRotateSpk(
        masterKey,
        resolvedUserId,
        identity,
      );
      if (spkResult.error) {
        if (process.env.NODE_ENV !== 'production') console.warn("SPK rotation issue during unlock:", spkResult.error);
      }

      setAuth(resolvedUserId, resolvedUsername, identity, masterKey);
      router.push("/chats");
    } catch (unlockError) {
      if (process.env.NODE_ENV !== 'production') console.error("Unlock error:", unlockError);
      const msg = unlockError instanceof Error ? unlockError.message : "Unlock error";
      setError(msg.startsWith("Too many") ? msg : "Unlock error");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && pin.length >= 4) {
      handleUnlock();
    }
  };

  const confirmReRegister = async () => {
    if (!pendingIdentity) return;
    setLoading(true);
    setShowReRegisterWarning(false);
    try {
      const settings = await loadSettings();
      const resolvedUsername = settings.username?.replace(/^@+/, "").trim();
      if (!resolvedUsername) {
        setError("Profile missing. Recover account with phrase.");
        return;
      }

      const bootstrapBundle = generatePreKeyBundle(
        pendingIdentity.exchange,
        pendingIdentity.signing,
        20,
      );
      const { data: created, error: createError } = await authApi.register({
        username: resolvedUsername,
        identityKey: pendingIdentity.signing.publicKey,
        exchangeIdentityKey: pendingIdentity.exchange.publicKey,
        signedPrekey: bootstrapBundle.signedPreKey.publicKey,
        signedPrekeySignature: bootstrapBundle.signature,
        oneTimePrekeys: bootstrapBundle.oneTimePreKeys.map((key, i) => ({
          id: `${resolvedUsername}-prekey-${i}`,
          publicKey: key.publicKey,
        })),
      });

      if (!created || createError) {
        setError("Re-registration failed. Try recovering with your phrase.");
        return;
      }

      const reRegMasterKey = await deriveMasterKeyFromPin(pin);
      await savePreKeyMaterial(
        {
          signedPreKey: bootstrapBundle.signedPreKey,
          oneTimePreKeys: bootstrapBundle.oneTimePreKeys,
          updatedAt: Date.now(),
        },
        reRegMasterKey,
      );
      await savePinHash(pin);

      await saveSettings({
        ...settings,
        userId: created.id,
        username: created.username,
      });

      setAuth(created.id, created.username, pendingIdentity, reRegMasterKey);
      router.push("/chats");
    } catch (e) {
      console.error("Re-register error:", e);
      setError("Re-registration error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="w-full max-w-md px-0">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-[0.28em] uppercase text-[var(--text-primary)]">
            L U M E
          </h1>
          <p className="auth-subtle mt-2">Enter PIN to continue.</p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            <span className="lume-badge">Unlock</span>
            <span className="lume-badge">Local PIN</span>
          </div>
        </div>

        <div className="auth-card lume-panel p-6 sm:p-8">
          <div className="mb-6">
            <label htmlFor="unlock-pin" className="block apple-label mb-2 text-center">PIN</label>
            <input
              id="unlock-pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="...."
              autoFocus
              className="apple-input text-center text-[20px] sm:text-2xl tracking-[0.42em]"
            />
            {error && (
              <p className="mt-3 text-sm text-[var(--text-secondary)] text-center">
                {error}
              </p>
            )}
          </div>

          <div className="space-y-3">
            <button
              onClick={handleUnlock}
              disabled={pin.length < 4 || loading}
              className="w-full apple-button disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 mono-spinner rounded-full animate-spin" />
                  Checking...
                </span>
              ) : (
                "Log In"
              )}
            </button>

            <button
              onClick={() => router.push("/recover")}
              className="w-full apple-button-secondary"
            >
              Recover with Phrase
            </button>
          </div>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => router.push("/")}
            className="text-sm apple-link"
          >
            Back to home
          </button>
        </div>
      </div>

      {showReRegisterWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="lume-panel w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] p-6 sm:p-8 shadow-lg">
            <h2 className="text-[14px] font-semibold uppercase tracking-[0.14em] text-[var(--text-primary)] mb-4">
              Account Not Found on Server
            </h2>
            <p className="text-[13px] text-[var(--text-secondary)] mb-2">
              Your account was not found on the server (the database may have
              been reset).
            </p>
            <p className="text-[13px] text-[var(--text-secondary)] mb-6">
              Re-registering will create a new server identity.{" "}
              <strong>
                Existing contacts will not be able to decrypt messages from your
                previous session.
              </strong>{" "}
              They will need to re-verify your safety number.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowReRegisterWarning(false);
                  setPendingIdentity(null);
                }}
                className="flex-1 apple-button-secondary"
              >
                Cancel
              </button>
              <button
                onClick={confirmReRegister}
                className="flex-1 apple-button"
                disabled={loading}
              >
                {loading ? "Re-registering..." : "Re-register"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
