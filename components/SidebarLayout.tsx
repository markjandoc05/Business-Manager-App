'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, 
  Users, 
  UserCircle, 
  Kanban, 
  CheckSquare, 
  BarChart3, 
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Briefcase,
  LogOut
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MobileNavigationProvider } from '@/components/MobileNavigationContext';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { canManageSettings } from '@/lib/permissions';
import { useWorkspace } from '@/context/WorkspaceContext';

const baseSidebarItems = [
  { section: 'MAIN', name: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { section: 'SALES', name: 'Leads', icon: Users, href: '/leads' },
  { section: 'SALES', name: 'Clients', icon: UserCircle, href: '/clients' },
  { section: 'SALES', name: 'Pipeline', icon: Kanban, href: '/pipeline' },
  { section: 'SALES', name: 'Tasks', icon: CheckSquare, href: '/tasks' },
  { section: 'INSIGHTS', name: 'Reports', icon: BarChart3, href: '/reports' },
  { section: 'WORKSPACE', name: 'Settings', icon: Settings, href: '/settings' },
];

const SIDEBAR_PREFERENCE_KEY = 'bsm_sidebar_collapsed';

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);
  const pathname = usePathname();
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const wasMobileOpen = useRef(false);
  const { user, signOut } = useAuth();
  const { settings } = useApp();
  const { membership, currentOrganization, licenseState, isReadOnly } = useWorkspace();
  const sidebarItems = baseSidebarItems.filter((item) => item.href !== '/settings' || canManageSettings(membership));
  const sidebarSections = ['MAIN', 'SALES', 'INSIGHTS', 'WORKSPACE'].map((section) => ({
    label: section,
    items: sidebarItems.filter((item) => item.section === section),
  })).filter((section) => section.items.length > 0);

  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1024;
      setIsDesktop(desktop);
      if (desktop) setIsMobileOpen(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY);
    if (saved !== null) setIsCollapsed(saved === 'true');
    setSidebarPreferenceLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (sidebarPreferenceLoaded) window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(isCollapsed));
  }, [isCollapsed, sidebarPreferenceLoaded]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDesktop) {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isDesktop]);

  /* eslint-disable react-hooks/set-state-in-effect -- close the transient drawer after route navigation. */
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (isMobileOpen && !isDesktop) {
      wasMobileOpen.current = true;
      mobileCloseButtonRef.current?.focus();
    } else if (!isMobileOpen && !isDesktop && wasMobileOpen.current) {
      wasMobileOpen.current = false;
      document.getElementById('mobile-navigation-trigger')?.focus();
    }
  }, [isDesktop, isMobileOpen]);

  useEffect(() => {
    if (!isMobileOpen || isDesktop) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isDesktop, isMobileOpen]);

  const sidebarCollapsed = isDesktop && isCollapsed;
  return (
    <MobileNavigationProvider openNavigation={() => setIsMobileOpen(true)} isOpen={isMobileOpen}>
      <div
        className="flex h-[100dvh] min-h-screen min-w-0 overflow-hidden bg-[#f7f7f8] text-slate-800 antialiased"
        style={{ '--sidebar-width': isDesktop ? (sidebarCollapsed ? '68px' : '248px') : '0px' } as React.CSSProperties}
      >
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[1px] lg:hidden"
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="mobile-navigation-drawer"
        aria-label="Navigation"
        aria-hidden={!isDesktop && !isMobileOpen}
        inert={!isDesktop && !isMobileOpen ? true : undefined}
        role={!isDesktop ? 'dialog' : undefined}
        aria-modal={!isDesktop ? true : undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(300px,85vw)] max-w-[85vw] -translate-x-full flex-col border-r border-slate-200 bg-white text-slate-700 shadow-xl transition-transform duration-200 ease-out lg:relative lg:z-auto lg:w-[var(--sidebar-width)] lg:max-w-none lg:translate-x-0 lg:shadow-none lg:transition-[width,transform] lg:duration-200",
          isMobileOpen && "translate-x-0",
          sidebarCollapsed ? "items-center" : "items-stretch"
        )}
        style={{ '--sidebar-width': sidebarCollapsed ? '68px' : '248px' } as React.CSSProperties}
      >
        {/* Logo Section */}
        <div className={cn(
          "flex h-14 items-center border-b border-slate-100",
          sidebarCollapsed ? "h-auto flex-col gap-2 px-2 py-3" : "justify-between px-4"
        )}>
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-cover bg-center"
              style={{ backgroundColor: settings.accentColor || '#3b82f6', ...(settings.logoUrl ? { backgroundImage: `url(${settings.logoUrl})` } : {}) }}
            >
              {!settings.logoUrl && <Briefcase size={18} className="text-white" />}
            </div>
            {!sidebarCollapsed && <div className="min-w-0"><p className="max-w-[150px] truncate text-sm font-semibold tracking-tight text-slate-900">{settings.businessName}</p><p className="max-w-[150px] truncate text-[11px] text-slate-400">{currentOrganization?.name || 'Workspace'}</p></div>}
          </div>
          {!sidebarCollapsed ? (
            <button 
              ref={mobileCloseButtonRef}
              type="button"
              onClick={() => isDesktop ? setIsCollapsed(true) : setIsMobileOpen(false)}
              aria-label={isDesktop ? 'Close sidebar' : 'Close navigation'}
              title={isDesktop ? 'Close sidebar' : 'Close navigation'}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
            >
              <PanelLeftClose size={18} />
            </button>
          ) : <button type="button" onClick={() => setIsCollapsed(false)} aria-label="Open sidebar" title="Open sidebar" className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"><PanelLeftOpen size={18} /></button>}
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto py-4", sidebarCollapsed ? "px-2" : "px-3")} aria-label="Primary navigation">
          {sidebarSections.map((section) => (
            <div key={section.label} className="mb-4 last:mb-0">
              {!sidebarCollapsed && <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{section.label}</p>}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "group flex h-9 items-center gap-3 rounded-lg text-[13px] transition-colors duration-150",
                        sidebarCollapsed ? "justify-center px-0" : "px-3",
                        isActive
                          ? "bg-blue-50 font-medium text-slate-900"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                      title={sidebarCollapsed ? item.name : undefined}
                      onClick={() => setIsMobileOpen(false)}
                    >
                      <item.icon size={18} className={cn("shrink-0", isActive ? "text-blue-600" : "text-slate-500 group-hover:text-slate-700")} />
                      {!sidebarCollapsed && <span>{item.name}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer Profile Section */}
        <div className={cn(
          "border-t border-slate-100 p-3",
          sidebarCollapsed ? "flex justify-center" : ""
        )}>
          {sidebarCollapsed ? (
             <button title="Sign out" aria-label="Sign out" onClick={() => signOut()} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">{user?.name.slice(0, 2).toUpperCase()}</button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">{user?.name.slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
                <p className="truncate text-[10px] text-slate-500">{membership?.role || 'Loading role…'}</p>
              </div>
              <button title="Sign out" onClick={() => signOut()} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30" aria-label="Sign out"><LogOut size={16} /></button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5 2xl:p-8">
          <div className="mx-auto w-full min-w-0 max-w-[1536px]">
            {licenseState.reason === 'trial' && licenseState.daysRemaining !== null && licenseState.daysRemaining <= 3 && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Your trial ends in {licenseState.daysRemaining} day{licenseState.daysRemaining === 1 ? '' : 's'}.</div>}
            {isReadOnly && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{licenseState.status === 'UNKNOWN' ? 'Subscription status could not be verified. This workspace is temporarily read-only.' : licenseState.reason === 'suspended' ? 'This workspace is currently suspended and is read-only.' : 'Your subscription has expired. Your workspace is read-only.'}</div>}
            {children}
          </div>
        </main>
      </div>
      </div>
    </MobileNavigationProvider>
  );
}
