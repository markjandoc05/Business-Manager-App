'use client';

import React from 'react';
import { Menu } from 'lucide-react';
import { useMobileNavigation } from '@/components/MobileNavigationContext';

export function PageHeader({ title, subtitle, actions, mobileQuickActions }: { title: string; subtitle: string; actions?: React.ReactNode; mobileQuickActions?: React.ReactNode }) {
  const mobileNavigation = useMobileNavigation();

  return (
    <header className={`page-header flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between${mobileQuickActions ? ' page-header-with-mobile-actions' : ''}`}>
      <div className="flex min-w-0 items-start gap-2">
        {mobileNavigation && <button
          id="mobile-navigation-trigger"
          type="button"
          onClick={mobileNavigation.openNavigation}
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 lg:hidden"
          aria-label="Open navigation"
          aria-controls="mobile-navigation-drawer"
          aria-expanded={mobileNavigation.isOpen}
        >
          <Menu size={20} />
        </button>}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      {actions && <div className={`page-header-actions flex w-full flex-wrap items-center gap-2 sm:w-auto${mobileQuickActions ? ' page-header-actions-with-mobile-menu' : ''}`}>{actions}</div>}
      {mobileQuickActions}
    </header>
  );
}
