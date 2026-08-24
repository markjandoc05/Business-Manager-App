import React from 'react';
import { cn } from '@/lib/utils';

type IconActionVariant = 'default' | 'primary' | 'danger' | 'success';

export function IconActionButton({ icon, label, onClick, onPointerDown, disabled, variant = 'default', className, type = 'button' }: {
  icon: React.ReactNode;
  label: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  variant?: IconActionVariant;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}) {
  const variants: Record<IconActionVariant, string> = {
    default: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
    primary: 'text-blue-600 hover:bg-blue-50 hover:text-blue-700',
    danger: 'text-slate-400 hover:bg-red-50 hover:text-red-600',
    success: 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700',
  };

  return <span className="group relative inline-flex">
    <button type={type} aria-label={label} title={label} onClick={onClick} onPointerDown={onPointerDown} disabled={disabled} className={cn('inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:pointer-events-none disabled:opacity-40', variants[variant], className)}>
      {icon}
    </button>
    <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-1.5 max-w-[calc(100vw-1.5rem)] overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {label}
    </span>
  </span>;
}
