'use client';

import React, { Children, Fragment, isValidElement, useId, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, List, Table2 } from 'lucide-react';

const subscribe = (callback: () => void) => {
  const query = window.matchMedia('(max-width: 767px)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
const mobileSnapshot = () => window.matchMedia('(max-width: 767px)').matches;
const serverSnapshot = () => false;

type ElementProps = React.HTMLAttributes<HTMLElement> & {
  children?: React.ReactNode;
  colSpan?: number;
  label?: string;
  direction?: 'asc' | 'desc';
  onSort?: () => void;
};

function elements(children: React.ReactNode): React.ReactElement<ElementProps>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<ElementProps>(child)) return [];
    return child.type === Fragment ? elements(child.props.children) : [child];
  });
}

/** Two presentations of the same rows: actions, selection, sorting and data stay owned by the page. */
export function ResponsiveTable({ children, columns, primaryColumn = 0, selectionColumn, actionColumn,
  summaryColumns = [], className, ...props }: React.TableHTMLAttributes<HTMLTableElement> & {
  columns: string[];
  primaryColumn?: number;
  selectionColumn?: number;
  actionColumn?: number;
  summaryColumns?: number[];
}) {
  const isMobile = useSyncExternalStore(subscribe, mobileSnapshot, serverSnapshot);
  const [tableView, setTableView] = useState(false);
  const contentId = useId();
  const sections = elements(children);
  const head = sections.find((section) => section.type === 'thead');
  const body = sections.find((section) => section.type === 'tbody');
  const headers = elements(elements(head?.props.children)[0]?.props.children);
  const rows = elements(body?.props.children);
  const sortable = headers.filter((header) => header.props.onSort);

  return <div className="responsive-records">
    {isMobile && <div className="record-view-toolbar">
      {selectionColumn !== undefined && !tableView && <label className="record-select-all">
        {headers[selectionColumn]?.props.children}<span>Select all</span>
      </label>}
      {sortable.length > 0 && !tableView && <details className="record-sort">
        <summary>Sort <ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="record-sort-options">{sortable.map((header) => <button key={header.props.label}
          type="button" onClick={header.props.onSort} aria-label={`Sort loaded results by ${header.props.label}`}
          aria-pressed={Boolean(header.props.direction)}>
          {header.props.label}
          {header.props.direction === 'asc' ? <ArrowUp size={15} /> : header.props.direction === 'desc' ? <ArrowDown size={15} /> : <ArrowUpDown size={15} />}
          <span className="sr-only">{header.props.direction === 'asc' ? 'Ascending' : header.props.direction === 'desc' ? 'Descending' : 'Not sorted'}</span>
        </button>)}</div>
      </details>}
      <button type="button" className="record-view-toggle" aria-controls={contentId}
        onClick={() => setTableView((current) => !current)}>
        {tableView ? <List size={17} aria-hidden="true" /> : <Table2 size={17} aria-hidden="true" />}
        {tableView ? 'List view' : 'Table view'}
      </button>
    </div>}
    <div id={contentId} className={isMobile && !tableView ? 'record-list-container' : 'record-table-scroll'}>
      {isMobile && !tableView ? <ul className="mobile-record-list" aria-label={props['aria-label'] || 'Records'}>
        {rows.map((row, index) => {
          const cells = elements(row.props.children);
          if (cells.length === 1 && cells[0].props.colSpan) return <li key={row.key || index} className="record-empty">{cells[0].props.children}</li>;
          const detailIndexes = columns.map((_, i) => i).filter((i) => i !== primaryColumn && i !== selectionColumn && i !== actionColumn && !summaryColumns.includes(i));
          return <li key={row.key || index} className="mobile-record" onClick={row.props.onClick}>
            <div className="record-heading">
              <div className="record-name">{cells[primaryColumn]?.props.children}</div>
              {selectionColumn !== undefined && <label className="record-selection" onClick={(event) => event.stopPropagation()}>{cells[selectionColumn]?.props.children}</label>}
            </div>
            <dl className="record-summary">{summaryColumns.map((i) => <div key={i}>
              <dt>{columns[i]}</dt><dd>{cells[i]?.props.children}</dd>
            </div>)}</dl>
            {detailIndexes.length > 0 && <details className="record-details" onClick={(event) => event.stopPropagation()}>
              <summary>Details <ChevronDown size={15} aria-hidden="true" /></summary>
              <dl>{detailIndexes.map((i) => <div key={i}><dt>{columns[i]}</dt><dd>{cells[i]?.props.children}</dd></div>)}</dl>
            </details>}
            {actionColumn !== undefined && <div className="record-actions" onClick={(event) => event.stopPropagation()}>{cells[actionColumn]?.props.children}</div>}
          </li>;
        })}
      </ul> : <table {...props} className={className}>{children}</table>}
    </div>
  </div>;
}
