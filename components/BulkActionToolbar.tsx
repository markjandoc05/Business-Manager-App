'use client';

import React from 'react';
import { Button } from '@/components/ui/core';

export type BulkActionOption = { value: string; label: string };

export function BulkActionToolbar({
  selectedCount,
  matchingCount,
  action,
  actions,
  processing,
  onSelectAllMatching,
  onActionChange,
  onApply,
  onClear,
}: {
  selectedCount: number;
  matchingCount: number;
  action: string;
  actions: BulkActionOption[];
  processing: boolean;
  onSelectAllMatching: () => void;
  onActionChange: (action: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  if (selectedCount === 0) return null;
  return <div className="fixed bottom-20 left-1/2 z-30 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 overflow-x-auto rounded-[var(--app-radius-card)] border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-surface)_96%,transparent)] px-4 py-3 text-sm text-[var(--app-muted)] shadow-[var(--app-shadow-md)] backdrop-blur xl:left-[calc(50%+var(--sidebar-width)/2)]" role="region" aria-label="Bulk actions">
    <span className="shrink-0 font-medium text-[var(--app-text)]">Selected: {selectedCount}</span>
    {selectedCount > 0 && selectedCount < matchingCount && <button type="button" className="shrink-0 font-medium text-[var(--app-primary)] underline underline-offset-2 hover:text-[var(--app-primary-hover)]" onClick={onSelectAllMatching} disabled={processing}>Select all {matchingCount} matching filtered records</button>}
    <select className="h-10 shrink-0 rounded-[var(--app-radius-control)] border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-1.5 text-sm text-[var(--app-text)] shadow-[var(--app-shadow-xs)]" value={action} onChange={(event) => onActionChange(event.target.value)} disabled={processing || selectedCount === 0} aria-label="Bulk action">
      <option value="">Bulk actions</option>
      {actions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    <Button size="sm" onClick={onApply} disabled={processing || selectedCount === 0 || !action}>{processing ? 'Processing…' : 'Apply'}</Button>
    {selectedCount > 0 && <Button size="sm" variant="ghost" onClick={onClear} disabled={processing}>Clear selection</Button>}
  </div>;
}
