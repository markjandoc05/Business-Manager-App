'use client';

import React, { useSyncExternalStore } from 'react';

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
  className, ...props }: React.TableHTMLAttributes<HTMLTableElement> & {
  columns: string[];
  primaryColumn?: number;
  selectionColumn?: number;
  actionColumn?: number;
  summaryColumns?: number[];
}) {
  const isMobile = useSyncExternalStore(subscribe, mobileSnapshot, serverSnapshot);
  return <div className="responsive-records">
    <div className="record-table-scroll" tabIndex={isMobile ? 0 : undefined}
      role={isMobile ? 'region' : undefined}
      aria-label={isMobile ? `${columns.filter((column) => !['Selection', 'Actions'].includes(column)).join(', ')} table; scroll horizontally for more columns` : undefined}>
      <table {...props} className={className}>{children}</table>
    </div>
  </div>;
}
