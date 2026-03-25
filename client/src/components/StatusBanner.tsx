'use client';

import { useUIStore } from '@/stores';

export default function StatusBanner() {
  const cryptoBanner = useUIStore((state) => state.cryptoBanner);
  const wsStatus = useUIStore((state) => state.wsStatus);

  // Prefer surfacing crypto/keys issues over transport noise.
  if (cryptoBanner) {
    const tone =
      cryptoBanner.level === 'error'
        ? 'text-[var(--accent)]'
        : cryptoBanner.level === 'warning'
        ? 'text-[var(--text-primary)]'
        : 'text-[var(--text-secondary)]';

    return (
      <div role="status" aria-live="polite" className={`w-full px-3 py-2 text-xs sm:text-sm text-center font-medium transition-colors duration-300 bg-[var(--surface)] border-b border-[var(--border)] animate-slide-down ${tone}`}>
        {cryptoBanner.message}
      </div>
    );
  }

  // Only show banners for real errors — not transient connecting/disconnected states
  if (wsStatus === 'connected' || wsStatus === 'connecting' || wsStatus === 'disconnected') return null;

  let content = '';
  let tone = 'text-[var(--text-secondary)]';
  const bg = 'bg-[var(--surface)]';

  switch (wsStatus) {
    case 'rate_limited':
      content = 'Лимит запросов. Повторите через 60 секунд.';
      tone = 'text-[var(--accent)]';
      break;
    case 'kicked':
      content = 'Отключено: слишком много активных сессий.';
      tone = 'text-[var(--accent)]';
      break;
    case 'auth_error':
      content = 'Ошибка аутентификации WebSocket';
      tone = 'text-[var(--accent)]';
      break;
    default:
      return null;
  }

  return (
    <div role="status" aria-live="polite" className={`w-full px-3 py-2 text-xs sm:text-sm text-center font-medium transition-colors duration-300 ${bg} ${tone} border-b border-[var(--border)] animate-slide-down`}>
      {content}
    </div>
  );
}
