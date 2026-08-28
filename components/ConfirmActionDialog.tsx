'use client';

import React from 'react';
import { Button } from '@/components/ui/core';
import { useEscapeKey } from '@/components/useEscapeKey';

type ConfirmVariant = 'default' | 'warning' | 'danger';

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscapeKey(onCancel, open && !loading);

  if (!open) return null;
  const confirmVariant = variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'primary';

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--app-primary)]/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onCancel(); }}>
    <div className="w-full max-w-md rounded-[var(--app-radius-panel)] border border-[var(--app-border)] bg-[var(--app-surface)] p-5 shadow-[var(--app-shadow-lg)]" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title" aria-describedby="confirm-action-description">
      <h2 id="confirm-action-title" className="text-base font-semibold text-[var(--app-text)]">{title}</h2>
      <p id="confirm-action-description" className="mt-2 text-sm leading-5 text-[var(--app-muted)]">{description}</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" autoFocus disabled={loading} onClick={onCancel}>{cancelLabel}</Button>
        <Button type="button" variant={confirmVariant} disabled={loading || confirmDisabled} onClick={onConfirm}>{loading ? `${confirmLabel}…` : confirmLabel}</Button>
      </div>
    </div>
  </div>;
}
