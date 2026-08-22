'use client';

import React, { useEffect } from 'react';
import { Button } from '@/components/ui/core';

type ConfirmVariant = 'default' | 'warning' | 'danger';

export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;
  const confirmVariant = variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'primary';

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onCancel(); }}>
    <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.14)]" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title" aria-describedby="confirm-action-description">
      <h2 id="confirm-action-title" className="text-base font-semibold text-slate-900">{title}</h2>
      <p id="confirm-action-description" className="mt-2 text-sm leading-5 text-slate-600">{description}</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" autoFocus disabled={loading} onClick={onCancel}>{cancelLabel}</Button>
        <Button type="button" variant={confirmVariant} disabled={loading} onClick={onConfirm}>{loading ? `${confirmLabel}…` : confirmLabel}</Button>
      </div>
    </div>
  </div>;
}
