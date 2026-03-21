'use client';

import React, { useEffect, useCallback } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  showCloseButton?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  showCloseButton = true,
}: ModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`
          relative w-full ${sizes[size]}
          bg-[var(--surface)] rounded-t-2xl sm:rounded-2xl
          border border-[var(--border)] shadow-[var(--shadow-lg)]
          transition-all duration-200
          max-h-[92dvh] flex flex-col
        `}
      >
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-[var(--border)]/70 flex-shrink-0">
            {title && <h2 className="text-sm font-semibold uppercase tracking-[0.04em] text-[var(--text-primary)]">{title}</h2>}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-[var(--surface-alt)] transition-colors"
                aria-label="Close"
              >
                <svg
                  className="w-4 h-4 text-[var(--text-muted)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        )}

        <div className="px-4 sm:px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export default Modal;
