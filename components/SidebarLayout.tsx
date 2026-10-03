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
  MessageCircleQuestion,
  PanelLeftClose,
  PanelLeftOpen,
  Briefcase,
  Package,
  ReceiptText,
  LogOut,
  Ellipsis
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MobileNavigationProvider } from '@/components/MobileNavigationContext';
import { SecurityTrustFooter } from '@/components/SecurityTrustFooter';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { canManageSettings } from '@/lib/permissions';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useDialogAccessibility } from '@/components/useDialogAccessibility';

const baseSidebarItems = [
  { section: 'MAIN', name: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { section: 'SALES', name: 'Leads', icon: Users, href: '/leads' },
  { section: 'SALES', name: 'Clients', icon: UserCircle, href: '/clients' },
  { section: 'SALES', name: 'Pipeline', icon: Kanban, href: '/pipeline' },
  { section: 'SALES', name: 'Catalog', icon: Package, href: '/catalog' },
  { section: 'SALES', name: 'Sales Log', icon: ReceiptText, href: '/sales' },
  { section: 'SALES', name: 'Tasks', icon: CheckSquare, href: '/tasks' },
  { section: 'INSIGHTS', name: 'Reports', icon: BarChart3, href: '/reports' },
  { section: 'WORKSPACE', name: 'Settings', icon: Settings, href: '/settings' },
  { section: 'WORKSPACE', name: 'Feedback & Support', icon: MessageCircleQuestion, href: '/feedback' },
];

const SIDEBAR_PREFERENCE_KEY = 'bsm_sidebar_collapsed';

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { settings } = useApp();
  const { membership, currentOrganization, licenseState, isReadOnly } = useWorkspace();
  const sidebarItems = baseSidebarItems.filter((item) => item.href !== '/settings' || canManageSettings(membership));
  const sidebarSections = ['MAIN', 'SALES', 'INSIGHTS', 'WORKSPACE'].map((section) => ({
    label: section,
    items: sidebarItems.filter((item) => item.section === section),
  })).filter((section) => section.items.length > 0);

  const [isDesktop, setIsDesktop] = useState(true);
  const navigationTriggerRef = useRef<HTMLElement | null>(null);
  const openNavigation = (event?: React.MouseEvent<HTMLButtonElement>) => {
    navigationTriggerRef.current = event?.currentTarget || document.getElementById('mobile-navigation-trigger');
    setIsMobileOpen(true);
  };
  const drawerRef = useDialogAccessibility<HTMLElement>(() => setIsMobileOpen(false), isMobileOpen && !isDesktop, true, navigationTriggerRef);
  const mobileTabs = baseSidebarItems.filter((item) => ['/', '/leads', '/clients', '/tasks'].includes(item.href));
  const moreActive = !mobileTabs.some((item) => item.href === pathname);

  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1200;
      setIsDesktop(desktop);
      if (desktop) setIsMobileOpen(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_PREFERENCE_KEY);
    if (saved !== null) setIsCollapsed(saved === 'true');
    setSidebarPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (sidebarPreferenceLoaded) window.localStorage.setItem(SIDEBAR_PREFERENCE_KEY, String(isCollapsed));
  }, [isCollapsed, sidebarPreferenceLoaded]);

  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);


  const sidebarCollapsed = isDesktop && isCollapsed;
  return (
    <MobileNavigationProvider openNavigation={openNavigation} isOpen={isMobileOpen}>
      <div
        className="flex h-[100dvh] min-h-0 min-w-0 overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)] antialiased"
        style={{ '--sidebar-width': isDesktop ? (sidebarCollapsed ? '68px' : '248px') : '0px' } as React.CSSProperties}
      >
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="fixed inset-0 z-40 bg-[var(--app-primary)]/30 backdrop-blur-[1px] xl:hidden"
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        ref={drawerRef}
        tabIndex={-1}
        id="mobile-navigation-drawer"
        aria-label="Navigation"
        aria-hidden={!isDesktop && !isMobileOpen}
        inert={!isDesktop && !isMobileOpen ? true : undefined}
        role={!isDesktop ? 'dialog' : undefined}
        aria-modal={!isDesktop ? true : undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(300px,85vw)] max-w-[85vw] -translate-x-full flex-col border-r border-white/10 bg-[var(--app-primary)] text-white shadow-[var(--app-shadow-lg)] transition-transform duration-200 ease-out xl:relative xl:z-auto xl:w-[var(--sidebar-width)] xl:max-w-none xl:translate-x-0 xl:shadow-none xl:transition-[width,transform] xl:duration-200",
          isMobileOpen && "translate-x-0",
          sidebarCollapsed ? "items-center" : "items-stretch"
        )}
        style={{ '--sidebar-width': sidebarCollapsed ? '68px' : '248px' } as React.CSSProperties}
      >
        {/* Logo Section */}
        <div className={cn(
          "flex h-16 items-center border-b border-white/10",
          sidebarCollapsed ? "h-auto flex-col gap-2 px-2 py-3" : "justify-between px-4"
        )}>
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[var(--app-radius-control)] border border-white/15 bg-cover bg-center shadow-[var(--app-shadow-xs)]"
              style={{ backgroundColor: settings.accentColor || '#3b82f6', ...(settings.logoUrl ? { backgroundImage: `url(${settings.logoUrl})` } : {}) }}
            >
              {!settings.logoUrl && <Briefcase size={18} className="text-white" />}
            </div>
            {!sidebarCollapsed && <div className="min-w-0"><p className="max-w-[150px] truncate text-sm font-semibold tracking-tight text-white">{settings.businessName}</p><p className="max-w-[150px] truncate text-xs text-white/60">{currentOrganization?.name || 'Workspace'}</p></div>}
          </div>
          {!sidebarCollapsed ? (
            <button 
              type="button"
              onClick={() => isDesktop ? setIsCollapsed(true) : setIsMobileOpen(false)}
              aria-label={isDesktop ? 'Close sidebar' : 'Close navigation'}
              title={isDesktop ? 'Close sidebar' : 'Close navigation'}
              className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--app-radius-control)] text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
            >
              <PanelLeftClose size={18} />
            </button>
          ) : <button type="button" onClick={() => setIsCollapsed(false)} aria-label="Open sidebar" title="Open sidebar" className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--app-radius-control)] text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"><PanelLeftOpen size={18} /></button>}
        </div>

        {/* Navigation */}
        <nav className={cn("flex-1 overflow-y-auto py-4", sidebarCollapsed ? "px-2" : "px-3")} aria-label="Primary navigation">
          {sidebarSections.map((section) => (
            <div key={section.label} className="mb-4 last:mb-0">
              {!sidebarCollapsed && <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">{section.label}</p>}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        "group flex h-10 items-center gap-3 rounded-[var(--app-radius-control)] text-[13px] transition-colors duration-150",
                        sidebarCollapsed ? "justify-center px-0" : "px-3",
                        isActive
                          ? "bg-[var(--app-accent)] font-semibold text-[var(--app-primary)]"
                          : "text-white/72 hover:bg-white/10 hover:text-white"
                      )}
                      title={sidebarCollapsed ? item.name : undefined}
                      onClick={() => setIsMobileOpen(false)}
                    >
                      <item.icon size={18} className={cn("shrink-0", isActive ? "text-[var(--app-primary)]" : "text-white/60 group-hover:text-white")} />
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
          "border-t border-white/10 p-3",
          sidebarCollapsed ? "flex justify-center" : ""
        )}>
          {sidebarCollapsed ? (
             <button title="Sign out" aria-label="Sign out" onClick={() => signOut()} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/12 text-xs font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]">{user?.name.slice(0, 2).toUpperCase()}</button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-xs font-semibold text-white">{user?.name.slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{user?.name}</p>
                <p className="truncate text-xs text-white/60">{user?.email}</p>
                <p className="sidebar-role-label truncate text-[10px] text-white/45">{membership?.role || 'Loading role…'}</p>
              </div>
              <button title="Sign out" onClick={() => signOut()} className="rounded-[var(--app-radius-control)] p-2 text-white/55 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]" aria-label="Sign out"><LogOut size={16} /></button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="app-main-content min-w-0 flex-1 overflow-y-auto p-3 min-[360px]:p-4 lg:p-5 2xl:p-8" inert={isMobileOpen && !isDesktop ? true : undefined}>
          <div className="mx-auto w-full min-w-0 max-w-[1536px]">
            {licenseState.reason === 'trial' && licenseState.daysRemaining !== null && licenseState.daysRemaining <= 3 && <div className="mb-4 rounded-lg border border-[color-mix(in_srgb,var(--app-warning)_50%,white)] bg-[color-mix(in_srgb,var(--app-warning)_13%,white)] px-3 py-2 text-sm text-[var(--app-text)]">Your trial ends in {licenseState.daysRemaining} day{licenseState.daysRemaining === 1 ? '' : 's'}.</div>}
            {isReadOnly && <div className="mb-4 rounded-lg border border-[color-mix(in_srgb,var(--app-warning)_50%,white)] bg-[color-mix(in_srgb,var(--app-warning)_13%,white)] px-3 py-2 text-sm text-[var(--app-text)]">{licenseState.status === 'UNKNOWN' ? 'Subscription status could not be verified. This workspace is temporarily read-only.' : licenseState.reason === 'suspended' ? 'This workspace is currently suspended and is read-only.' : 'Your subscription has expired. Your workspace is read-only.'}</div>}
            {children}
            <SecurityTrustFooter />
          </div>
        </main>
      </div>
      <nav className="mobile-tab-bar" aria-label="Mobile navigation" inert={isMobileOpen ? true : undefined}>
        {mobileTabs.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined}>
          <item.icon size={22} strokeWidth={pathname === item.href ? 2.2 : 1.7} aria-hidden="true" />
          <span>{item.href === '/' ? 'Home' : item.name}</span>
        </Link>)}
        <button type="button" onClick={openNavigation} aria-label="More navigation" aria-expanded={isMobileOpen} aria-controls="mobile-navigation-drawer" data-active={moreActive || undefined}>
          <Ellipsis size={22} aria-hidden="true" /><span>More</span>
        </button>
      </nav>
      </div>
    </MobileNavigationProvider>
  );
}
