'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateMnemonic, recoverIdentityFromMnemonic } from '@/crypto/mnemonic';
import { saveIdentityKeys, loadSettings, saveSettings, savePreKeyMaterial, deriveMasterKeyFromPin, savePinHash } from '@/crypto/storage';
import { useAuthStore } from '@/stores';
import { authApi } from '@/lib/api';
import { generatePreKeyBundle } from '@/crypto/keys';

export default function RecoverPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  const [mnemonic, setMnemonic] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [step, setStep] = useState<'phrase' | 'pin'>('phrase');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleValidatePhrase = () => {
    if (!username || !/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      setError('Enter a valid username');
      return;
    }

    const trimmed = mnemonic.trim().toLowerCase();
    const words = trimmed.split(/\s+/);

    if (words.length !== 12 && words.length !== 24) {
      setError('Phrase must contain 12 or 24 words');
      return;
    }

    if (!validateMnemonic(trimmed)) {
      setError('Invalid recovery phrase');
      return;
    }

    setError('');
    setStep('pin');
  };

  const handleRecover = async () => {
    if (pin.length < 4) {
      setError('PIN must be at least 4 chars');
      return;
    }

    if (pin !== pinConfirm) {
      setError('PINs do not match');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const trimmed = mnemonic.trim().toLowerCase();
      const identity = await recoverIdentityFromMnemonic(trimmed);
      const { data, error: getUserError } = await authApi.getUser(username, identity);

      if (getUserError || !data) {
        setError('Account not found on server');
        return;
      }

      if (data.identityKey !== identity.signing.publicKey) {
        setError('Recovery phrase does not match this username');
        return;
      }

      // Derive master key from PIN — PIN is only used here, never stored
      const masterKey = await deriveMasterKeyFromPin(pin);

      await saveIdentityKeys(identity, masterKey);
      await savePinHash(pin);

      const settings = await loadSettings();
      await saveSettings({
        ...settings,
        username: data.username,
        userId: data.id,
      });

      const preKeyBundle = generatePreKeyBundle(identity.exchange, identity.signing, 20);
      await savePreKeyMaterial(
        {
          signedPreKey: preKeyBundle.signedPreKey,
          oneTimePreKeys: preKeyBundle.oneTimePreKeys,
          updatedAt: Date.now(),
        },
        masterKey
      );
      const { error: rotateError } = await authApi.updateSignedPrekey(
        data.id,
        preKeyBundle.signedPreKey.publicKey,
        preKeyBundle.signature,
        identity
      );
      if (rotateError) {
        console.warn('Signed prekey rotation skipped during recovery:', rotateError);
      }

      try {
        await authApi.uploadPrekeys(
          data.id,
          preKeyBundle.oneTimePreKeys.map((key, i) => ({
            id: `recovery-prekey-${Date.now()}-${i}`,
            publicKey: key.publicKey,
          })),
          identity
        );
      } catch (uploadError) {
        console.warn('Prekey refill failed after recovery:', uploadError);
      }

      setAuth(data.id, data.username, identity, masterKey);
      router.push('/chats');
    } catch (recoverError) {
      console.error('Recovery error:', recoverError);
      setError('Recovery error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="w-full max-w-md px-0">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-[0.28em] uppercase text-[var(--text-primary)]">L U M E</h1>
          <p className="auth-subtle mt-2">Restore access using recovery phrase.</p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            <span className="lume-badge">Recovery</span>
            <span className="lume-badge">Phrase</span>
          </div>
        </div>

        <div className="auth-card lume-panel p-5 sm:p-8">
          {step === 'phrase' && (
            <>
              <div className="mb-6">
                <label htmlFor="recover-username" className="block apple-label mb-2">Username</label>
                <div className="relative mb-4">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">@</span>
                  <input
                    id="recover-username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/^@+/, '').trim())}
                    placeholder="username"
                    className="apple-input apple-input-icon"
                  />
                </div>
                <label htmlFor="recover-mnemonic" className="block apple-label mb-2">Recovery Phrase</label>
                <textarea
                  id="recover-mnemonic"
                  value={mnemonic}
                  onChange={(e) => setMnemonic(e.target.value)}
                  placeholder="Enter your words"
                  rows={4}
                  className="apple-textarea"
                />
                {error && <p className="mt-2 text-sm text-[var(--text-secondary)]">{error}</p>}
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleValidatePhrase}
                  disabled={!mnemonic.trim() || !username.trim()}
                  className="w-full apple-button disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
                <button onClick={() => router.push('/')} className="w-full apple-button-secondary">
                  Back
                </button>
              </div>
            </>
          )}

          {step === 'pin' && (
            <>
              <div className="mb-6">
                <label htmlFor="recover-pin" className="block apple-label mb-2">New PIN</label>
                <input
                  id="recover-pin"
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="...."
                  className="apple-input mb-4"
                />

                <label htmlFor="recover-pin-confirm" className="block apple-label mb-2">Repeat PIN</label>
                <input
                  id="recover-pin-confirm"
                  type="password"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value)}
                  placeholder="...."
                  className="apple-input"
                />
                {error && <p className="mt-2 text-sm text-[var(--text-secondary)]">{error}</p>}
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleRecover}
                  disabled={!pin || !pinConfirm || loading}
                  className="w-full apple-button disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 mono-spinner rounded-full animate-spin" />
                      Recovering...
                    </span>
                  ) : (
                    'Recover'
                  )}
                </button>
                <button onClick={() => setStep('phrase')} className="w-full apple-button-secondary">
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
