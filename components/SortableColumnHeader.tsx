'use client';

import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDirection } from '@/lib/table-sorting';

export function SortableColumnHeader({
  label,
  direction,
  onSort,
  align = 'left',
  compact = false,
  fullWidth = false,
}: {
  label: string;
  direction?: SortDirection;
  onSort: () => void;
  align?: 'left' | 'center' | 'right';
  compact?: boolean;
  fullWidth?: boolean;
}) {
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none';
  return (
    <th scope="col" aria-sort={ariaSort} className={`whitespace-nowrap ${fullWidth ? 'px-4' : 'px-3'} ${compact ? 'py-3' : 'py-4'} text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--app-muted)] ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}`}>
      <button
        type="button"
        onClick={onSort}
        className={`group inline-flex items-center gap-1 rounded-[var(--app-radius-sm)] py-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--app-muted)] transition-colors hover:text-[var(--app-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)] ${align === 'right' ? 'justify-end text-right' : align === 'center' ? 'justify-center text-center' : 'text-left'}`}
        aria-label={`Sort loaded results by ${label}`}
        title="Sorts the currently loaded results"
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-[var(--app-tertiary)] group-hover:text-[var(--app-primary)]">
          {direction === 'asc' ? <ArrowUp size={13} /> : direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUpDown size={13} />}
        </span>
      </button>
    </th>
  );
}
