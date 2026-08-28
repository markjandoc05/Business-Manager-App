import React from 'react';
import { cn } from '@/lib/utils';

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[var(--app-radius-card)] border border-[var(--app-border)] bg-[var(--app-surface)] p-5 text-[var(--app-text)] shadow-[var(--app-shadow-xs)]", className)}>
      {children}
    </div>
  );
}

export function Button({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className, 
  ...props 
}: { 
  children: React.ReactNode; 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'warning' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants = {
    primary: 'bg-[var(--app-primary)] text-white hover:bg-[var(--app-primary-hover)] active:brightness-90',
    secondary: 'border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-accent-soft)] active:brightness-95',
    outline: 'border border-[var(--app-border)] bg-[var(--app-surface)] text-[var(--app-text)] hover:bg-[var(--app-accent-soft)] active:brightness-95',
    ghost: 'bg-transparent text-[var(--app-muted)] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] active:brightness-95',
    warning: 'border border-[color-mix(in_srgb,var(--app-warning)_55%,white)] bg-[color-mix(in_srgb,var(--app-warning)_14%,white)] text-[var(--app-text)] hover:bg-[color-mix(in_srgb,var(--app-warning)_22%,white)] active:brightness-95',
    danger: 'bg-[var(--app-danger)] text-white hover:brightness-90 active:brightness-80',
  };

  const sizes = {
    sm: 'h-10 px-4 text-sm',
    md: 'h-11 px-4 text-sm',
    lg: 'h-11 px-5 text-sm',
  };

  return (
    <button 
      className={cn(
        "app-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-[background-color,color,border-color,filter] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({ children, variant = 'gray' }: { children: React.ReactNode; variant?: 'blue' | 'green' | 'orange' | 'red' | 'gray' | 'purple' }) {
  const variants = {
    blue: 'border-[var(--app-border)] bg-[var(--app-accent-soft)] text-[var(--app-primary)]',
    green: 'border-[var(--app-border)] bg-[var(--app-accent-soft)] text-[var(--app-primary)]',
    orange: 'border-[color-mix(in_srgb,var(--app-warning)_45%,white)] bg-[color-mix(in_srgb,var(--app-warning)_14%,white)] text-[var(--app-text)]',
    red: 'border-[color-mix(in_srgb,var(--app-danger)_35%,white)] bg-[color-mix(in_srgb,var(--app-danger)_10%,white)] text-[var(--app-danger)]',
    gray: 'border-[var(--app-border)] bg-[var(--app-surface-subtle)] text-[var(--app-muted)]',
    purple: 'border-[var(--app-border)] bg-[var(--app-accent-soft)] text-[var(--app-primary)]',
  };

  return (
    <span className={cn("inline-flex min-h-5 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]", variants[variant])}>
      {children}
    </span>
  );
}

export function Alert({ children, variant = 'error', className }: { children: React.ReactNode; variant?: 'error' | 'warning' | 'success' | 'info'; className?: string }) {
  const variants = {
    error: 'border-[color-mix(in_srgb,var(--app-danger)_35%,white)] bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] text-[var(--app-danger)]',
    warning: 'border-[color-mix(in_srgb,var(--app-warning)_50%,white)] bg-[color-mix(in_srgb,var(--app-warning)_13%,white)] text-[var(--app-text)]',
    success: 'border-[var(--app-border)] bg-[var(--app-accent-soft)] text-[var(--app-primary)]',
    info: 'border-[var(--app-border)] bg-[var(--app-surface-subtle)] text-[var(--app-muted)]',
  };
  return <div className={cn('rounded-[var(--app-radius-control)] border px-3 py-2.5 text-sm leading-5', variants[variant], className)}>{children}</div>;
}

export function EmptyState({ title, description, action, className }: { title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return <div className={cn('flex min-h-48 flex-col items-center justify-center rounded-[var(--app-radius-card)] border border-dashed border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-8 text-center', className)}>
    <p className="text-sm font-semibold text-[var(--app-text)]">{title}</p>
    {description && <p className="mt-1 max-w-md text-xs leading-5 text-[var(--app-muted)]">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>;
}

export function LoadingState({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return <div className={cn('flex min-h-48 items-center justify-center rounded-[var(--app-radius-card)] border border-[var(--app-border-subtle)] bg-[var(--app-surface)] p-8 text-sm text-[var(--app-muted)]', className)} aria-busy="true" aria-live="polite">{label}</div>;
}
