'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasAccount } from '@/crypto/storage';
import ThemeToggle from '@/components/theme/ThemeToggle';

export default function HomePage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [accountExists, setAccountExists] = useState(false);

  useEffect(() => {
    async function checkAccount() {
      const exists = await hasAccount();
      setAccountExists(exists);
      setChecking(false);
    }

    checkAccount();
  }, []);

  if (checking) {
    return (
      <div className="auth-shell" aria-busy="true">
        <div className="w-8 h-8 border-2 mono-spinner rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <main className="auth-shell">
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md px-0 relative z-10">
        <div className="auth-card lume-panel p-5 sm:p-8 animate-fade-in-scale">
          <div className="text-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-semibold uppercase tracking-[0.28em] text-[var(--text-primary)]">
              L U M E
            </h1>
            <p className="mt-3 text-[11px] uppercase tracking-[0.28em] text-[var(--text-secondary)]">
              Private by default
            </p>
          </div>

          <div className="space-y-3">
            {accountExists ? (
              <>
                <button onClick={() => router.push('/unlock')} className="w-full apple-button">
                  Log In
                </button>
                <button onClick={() => router.push('/setup')} className="w-full apple-button-secondary">
                  New Account
                </button>
              </>
            ) : (
              <>
                <button onClick={() => router.push('/setup')} className="w-full apple-button">
                  Create Account
                </button>
                <button onClick={() => router.push('/recover')} className="w-full apple-button-secondary">
                  Restore Access
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
