'use client';

import { Button } from '@/components/ui/core';
import { ModalHeader } from '@/components/ModalCloseButton';

export function RecordDetailsStatusDialog({ title, error, onClose, onRetry }: {
  title: string; error: string | null; onClose: () => void; onRetry: () => void;
}) {
  return <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="app-modal-panel w-full max-w-lg space-y-4 rounded-2xl bg-white p-4 sm:p-6">
      <ModalHeader title={title} onClose={onClose} />
      {error ? <><p role="alert" className="text-sm text-[var(--app-danger)]">{error}</p><Button variant="outline" onClick={onRetry}>Try again</Button></>
        : <p role="status" className="text-sm text-[var(--app-muted)]">Loading record details…</p>}
    </div>
  </div>;
}
