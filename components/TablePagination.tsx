'use client';

import React from 'react';

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function getPageItems(page: number, pageCount: number): Array<number | 'left-ellipsis' | 'right-ellipsis'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages = new Set([1, pageCount, page, page - 1, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sortedPages = [...pages].sort((left, right) => left - right);
  const items: Array<number | 'left-ellipsis' | 'right-ellipsis'> = [];
  sortedPages.forEach((value, index) => {
    const previous = sortedPages[index - 1];
    if (index > 0 && value - previous > 1) items.push(index === 1 ? 'left-ellipsis' : 'right-ellipsis');
    items.push(value);
  });
  return items;
}

export function TablePagination({
  page,
  pageSize,
  totalCount,
  hasMore = false,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  hasMore?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  if (totalCount === 0) return null;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(page, 1), pageCount);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalCount);

  return <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-500 sm:px-4 lg:px-6" aria-label="Table pagination">
    <label className="inline-flex items-center gap-2 whitespace-nowrap">
      <span>Rows per page:</span>
      <select className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} aria-label="Rows per page">
        {PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
    <span className="whitespace-nowrap font-medium text-slate-600">{start}–{end} of {totalCount}{hasMore ? '+' : ''}</span>
    <div className="flex items-center gap-1">
      <button type="button" className="rounded-lg px-2.5 py-1.5 font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>‹ <span className="hidden sm:inline">Previous</span></button>
      <div className="hidden items-center gap-1 sm:flex">
        {getPageItems(currentPage, pageCount).map((item) => item === 'left-ellipsis' || item === 'right-ellipsis'
          ? <span key={item} className="px-1.5 text-slate-400">…</span>
          : <button key={item} type="button" className={`min-w-8 rounded-lg px-2 py-1.5 font-medium transition-colors ${item === currentPage ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`} onClick={() => onPageChange(item)} aria-current={item === currentPage ? 'page' : undefined}>{item}</button>)}
      </div>
      <button type="button" className="rounded-lg px-2.5 py-1.5 font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === pageCount}><span className="hidden sm:inline">Next</span> ›</button>
    </div>
  </nav>;
}
