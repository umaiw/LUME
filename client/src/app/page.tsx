'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasAccount } from '@/crypto/storage';
import ThemeToggle from '@/components/theme/ThemeToggle';
import AntigravityField from '@/components/ui/AntigravityField';

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
    <main className="auth-antigravity">
      {/* ThemeToggle stays fixed in corner, outside the physics field */}
      <div className="auth-antigravity__theme">
        <ThemeToggle />
      </div>

      <AntigravityField speed={0.5} bounceDamping={0.88} className="auth-antigravity__field">
        {/* Logo */}
        <div className="auth-ag-logo">
          <h1 className="auth-ag-logo__title">L U M E</h1>
        </div>

        {/* Tagline */}
        <div className="auth-ag-tagline">
          <p className="auth-ag-tagline__text">Private by default</p>
        </div>

        {/* Buttons */}
        {accountExists ? (
          <>
            <div className="auth-ag-action">
              <button
                onClick={() => router.push('/unlock')}
                className="apple-button auth-ag-btn"
              >
                Log In
              </button>
            </div>

            <div className="auth-ag-action">
              <button
                onClick={() => router.push('/setup')}
                className="apple-button-secondary auth-ag-btn"
              >
                New Account
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="auth-ag-action">
              <button
                onClick={() => router.push('/setup')}
                className="apple-button auth-ag-btn"
              >
                Create Account
              </button>
            </div>

            <div className="auth-ag-action">
              <button
                onClick={() => router.push('/recover')}
                className="apple-button-secondary auth-ag-btn"
              >
                Restore Access
              </button>
            </div>
          </>
        )}

        {/* Decorative badge */}
        <div className="auth-ag-badge">
          <span className="lume-badge">E2EE</span>
        </div>

        {/* Another decorative element */}
        <div className="auth-ag-badge">
          <span className="lume-badge">Zero Knowledge</span>
        </div>
      </AntigravityField>
    </main>
  );
}
