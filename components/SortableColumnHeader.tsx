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
    <th scope="col" aria-sort={ariaSort} className={`whitespace-nowrap ${fullWidth ? 'px-4' : 'px-3'} ${compact ? 'py-3' : 'py-4'} text-xs font-bold uppercase text-slate-500 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}`}>
      <button
        type="button"
        onClick={onSort}
        className={`group inline-flex items-center gap-1 rounded-md py-1 text-xs font-bold uppercase text-slate-500 transition-colors hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 ${align === 'right' ? 'justify-end text-right' : align === 'center' ? 'justify-center text-center' : 'text-left'}`}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="text-slate-400 group-hover:text-slate-600">
          {direction === 'asc' ? <ArrowUp size={13} /> : direction === 'desc' ? <ArrowDown size={13} /> : <ArrowUpDown size={13} />}
        </span>
      </button>
    </th>
  );
}
