import React from 'react';
import { GripVertical, Info, type LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/core';
import { cn } from '@/lib/utils';
export { reorderKpiIds } from '@/lib/kpi-preferences';
export function StandardKpiCard({ label, value, description, context, icon: Icon, unavailable = false }: { label: string; value: React.ReactNode; description: string; context: string; icon: LucideIcon; unavailable?: boolean }) {
  return <Card className="dashboard-kpi-card bsm-kpi-card min-h-[118px] p-3 sm:min-h-[128px] sm:p-4"><div className="bsm-kpi-heading relative pr-5"><span className="bsm-kpi-icon"><Icon size={17} aria-hidden="true" /></span><span>{label}</span><span tabIndex={0} role="img" aria-label={`About ${label}`} className="kpi-info-trigger group absolute right-0 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--app-tertiary)] transition-[right,color] duration-150 hover:text-[var(--app-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30"><Info size={14} /><span role="tooltip" className="pointer-events-none absolute right-0 top-6 z-20 w-56 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-2 text-xs font-normal leading-snug text-[var(--app-text)] opacity-0 shadow-[var(--app-shadow-sm)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{description}</span></span></div><p className="bsm-kpi-value">{unavailable ? 'Unavailable' : value}</p><p className="bsm-kpi-description">{context}</p></Card>;
}

export function MovableKpiCard({ cardId, order, onDragStart, onDragEnd, onDrop, children, className }: { cardId: string; order: number; onDragStart: (cardId: string) => void; onDragEnd: () => void; onDrop: () => void; children: React.ReactNode; className?: string }) {
  return <div style={{ order }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(); }} className={cn('kpi-drag-container relative min-w-0', className)}>
    <button type="button" draggable aria-label={`Hold and drag ${cardId} to reorder KPI cards`} title="Hold to reveal, then drag to reorder" onDragStart={() => onDragStart(cardId)} onDragEnd={onDragEnd} className="dashboard-card-drag-handle absolute right-3 top-3 z-20 cursor-grab rounded-md p-1 text-[var(--app-tertiary)] opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-[var(--app-surface-subtle)] hover:text-[var(--app-muted)] active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30">
      <GripVertical size={16} aria-hidden="true" />
    </button>
    {children}
  </div>;
}

export function KpiCardGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bsm-kpi-grid grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-6', className)}>{children}</div>;
}
