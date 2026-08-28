'use client';

import React from 'react';
import { Menu } from 'lucide-react';
import { useMobileNavigation } from '@/components/MobileNavigationContext';

export function PageHeader({ title, subtitle, actions, mobileQuickActions }: { title: string; subtitle: string; actions?: React.ReactNode; mobileQuickActions?: React.ReactNode }) {
  const mobileNavigation = useMobileNavigation();

  return (
    <header className={`page-header flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between${mobileQuickActions ? ' page-header-with-mobile-actions' : ''}`}>
      <div className="flex min-w-0 items-start gap-2">
        {mobileNavigation && <button
          id="mobile-navigation-trigger"
          type="button"
          onClick={mobileNavigation.openNavigation}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--app-radius-control)] text-[var(--app-muted)] transition-colors hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)] xl:hidden"
          aria-label="Open navigation"
          aria-controls="mobile-navigation-drawer"
          aria-expanded={mobileNavigation.isOpen}
        >
          <Menu size={20} />
        </button>}
        <div className="min-w-0">
          <h1 className="break-words text-[22px] font-bold leading-[30px] tracking-[-0.02em] text-[var(--app-text)] md:text-[28px] md:leading-9">{title}</h1>
          <p className="mt-1 text-sm leading-5 text-[var(--app-muted)]">{subtitle}</p>
        </div>
      </div>
      {actions && <div className={`page-header-actions flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto md:self-start md:justify-end${mobileQuickActions ? ' page-header-actions-with-mobile-menu' : ''}`}>{actions}</div>}
      {mobileQuickActions}
    </header>
  );
}
