import React from 'react';
import { X } from 'lucide-react';
import { useEscapeKey } from '@/components/useEscapeKey';

export function ModalCloseButton({ onClose }: { onClose: () => void }) {
  useEscapeKey(onClose);

  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--app-accent-soft)] text-[var(--app-primary)] transition-colors hover:bg-[var(--app-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)] focus-visible:ring-offset-2"
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
}

export function ModalHeader({ title, subtitle, onClose }: { title: React.ReactNode; subtitle?: React.ReactNode; onClose: () => void }) {
  return (
    <div className="app-modal-header">
      <div className="min-w-0">
        <h2 className="app-modal-title">{title}</h2>
        {subtitle && <p className="mt-1 text-sm leading-5 text-[var(--app-muted)]">{subtitle}</p>}
      </div>
      <ModalCloseButton onClose={onClose} />
    </div>
  );
}
