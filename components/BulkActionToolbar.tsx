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
  return <div className="fixed bottom-6 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 overflow-x-auto rounded-xl border border-slate-200/80 bg-white/95 px-4 py-3 text-sm text-slate-700 shadow-[0_12px_35px_rgba(15,23,42,0.14)] backdrop-blur lg:left-[calc(50%+var(--sidebar-width)/2)]" role="region" aria-label="Bulk actions">
    <span className="shrink-0 font-medium text-slate-800">Selected: {selectedCount}</span>
    {selectedCount > 0 && selectedCount < matchingCount && <button type="button" className="shrink-0 font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900" onClick={onSelectAllMatching} disabled={processing}>Select all {matchingCount} matching filtered records</button>}
    <select className="h-9 shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 shadow-sm" value={action} onChange={(event) => onActionChange(event.target.value)} disabled={processing || selectedCount === 0} aria-label="Bulk action">
      <option value="">Bulk actions</option>
      {actions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
    <Button size="sm" onClick={onApply} disabled={processing || selectedCount === 0 || !action}>{processing ? 'Processing…' : 'Apply'}</Button>
    {selectedCount > 0 && <Button size="sm" variant="ghost" onClick={onClear} disabled={processing}>Clear selection</Button>}
  </div>;
}
