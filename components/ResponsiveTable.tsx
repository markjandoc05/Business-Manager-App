'use client';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const subscribe = (callback: () => void) => {
  const query = window.matchMedia('(max-width: 767px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
const mobileSnapshot = () => window.matchMedia('(max-width: 767px)').matches;
const serverSnapshot = () => false;

/** Keep the page's semantic table, selection, sorting, and actions in one scroll container. */
export function ResponsiveTable({ children, columns, primaryColumn: _primaryColumn,
  selectionColumn: _selectionColumn, actionColumn: _actionColumn, summaryColumns: _summaryColumns,
  className, fullWidthRowHover = false, ...props }: React.TableHTMLAttributes<HTMLTableElement> & {
  columns: string[];
  primaryColumn?: number;
  selectionColumn?: number;
  actionColumn?: number;
  summaryColumns?: number[];
  fullWidthRowHover?: boolean;
}) {
  const isMobile = useSyncExternalStore(subscribe, mobileSnapshot, serverSnapshot);
  const recordsRef = useRef<HTMLDivElement>(null);
  const [hoveredRow, setHoveredRow] = useState<{ element: HTMLTableRowElement; top: number; height: number } | null>(null);

  const updateRowHover = useCallback((row: HTMLTableRowElement | null) => {
    const records = recordsRef.current;
    if (!isMobile || !fullWidthRowHover || !row || !records?.contains(row)) {
      setHoveredRow(null);
      return;
    }
    const bounds = row.getBoundingClientRect();
    const top = bounds.top - records.getBoundingClientRect().top;
    setHoveredRow((current) => current?.element === row && current.top === top && current.height === bounds.height
      ? current : { element: row, top, height: bounds.height });
  }, [isMobile, fullWidthRowHover]);

  useEffect(() => {
    updateRowHover(hoveredRow ? recordsRef.current?.querySelector<HTMLTableRowElement>('tbody > tr:hover') ?? null : null);
  }, [children, hoveredRow, updateRowHover]);

  return <div ref={recordsRef} className={`responsive-records${fullWidthRowHover ? ' responsive-records-full-row-hover' : ''}`}
    data-hovered-row={hoveredRow ? true : undefined}
    style={hoveredRow ? { '--record-row-hover-top': `${hoveredRow.top}px`, '--record-row-hover-height': `${hoveredRow.height}px` } as React.CSSProperties : undefined}
    onPointerMove={fullWidthRowHover ? (event) => updateRowHover(event.pointerType === 'touch' ? null : (event.target as Element).closest<HTMLTableRowElement>('tbody > tr')) : undefined}
    onPointerLeave={fullWidthRowHover ? () => setHoveredRow(null) : undefined}
    onScrollCapture={fullWidthRowHover ? () => updateRowHover(hoveredRow?.element ?? null) : undefined}>
    <div className="record-table-scroll" tabIndex={isMobile ? 0 : undefined}
      role={isMobile ? 'region' : undefined}
      aria-label={isMobile ? `${columns.filter((column) => !['Selection', 'Actions'].includes(column)).join(', ')} table; scroll horizontally for more columns` : undefined}>
      <table {...props} className={className}>{children}</table>
    </div>
  </div>;
}
