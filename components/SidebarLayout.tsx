'use client';

import React, { useState, useEffect } from 'react';
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
  ChevronLeft,
  Briefcase,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { canManageSettings } from '@/lib/permissions';
import { useWorkspace } from '@/context/WorkspaceContext';

const baseSidebarItems = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { name: 'Leads', icon: Users, href: '/leads' },
  { name: 'Clients', icon: UserCircle, href: '/clients' },
  { name: 'Pipeline', icon: Kanban, href: '/pipeline' },
  { name: 'Tasks', icon: CheckSquare, href: '/tasks' },
  { name: 'Reports', icon: BarChart3, href: '/reports' },
  { name: 'Settings', icon: Settings, href: '/settings' },
];

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { settings } = useApp();
  const { membership } = useWorkspace();
  const sidebarItems = baseSidebarItems.filter((item) => item.href !== '/settings' || canManageSettings(membership));

  const [isDesktop, setIsDesktop] = useState(true);

  // Handle responsive behavior
  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1024;
      setIsDesktop(desktop);
      setIsCollapsed(!desktop);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const sidebarCollapsed = isDesktop && isCollapsed;

  return (
    <div className="flex h-screen bg-[#f7f7f8] text-slate-800 antialiased">
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        animate={{ 
          width: sidebarCollapsed ? '64px' : '224px',
          x: isMobileOpen || isDesktop ? 0 : -224
        }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-[#f7f7f8] text-slate-700 transition-all duration-300 ease-in-out lg:relative border-r border-slate-200",
          sidebarCollapsed ? "items-center" : "items-stretch"
        )}
      >
        {/* Logo Section */}
        <div className={cn(
          "flex items-center h-14 px-5 border-b border-slate-200",
          sidebarCollapsed ? "h-auto flex-col gap-1 px-2 py-2" : "justify-between"
        )}>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-cover bg-center shadow-sm"
              style={{ backgroundColor: settings.accentColor || '#3b82f6', ...(settings.logoUrl ? { backgroundImage: `url(${settings.logoUrl})` } : {}) }}
            >
              {!settings.logoUrl && <Briefcase size={18} className="text-white" />}
            </div>
            {!sidebarCollapsed && <span className="max-w-[135px] truncate text-sm font-semibold tracking-tight text-slate-900">{settings.businessName}</span>}
          </div>
          {!sidebarCollapsed ? (
            <button 
              onClick={() => setIsCollapsed(true)}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className="hidden rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 lg:flex"
            >
              <ChevronLeft size={18} />
            </button>
          ) : <button onClick={() => setIsCollapsed(false)} aria-label="Expand sidebar" title="Expand sidebar" className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"><ChevronLeft size={18} className="rotate-180" /></button>}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-5 space-y-0.5 overflow-y-auto">
          {sidebarItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md px-3 text-[13px] transition-colors duration-150 group",
                  sidebarCollapsed ? "justify-center" : "",
                  isActive 
                    ? "bg-slate-200 text-slate-900 font-medium"
                    : "text-slate-600 hover:bg-slate-200/80 hover:text-slate-900"
                )}
                title={sidebarCollapsed ? item.name : undefined}
                style={isActive ? { color: settings.accentColor || '#3b82f6' } : undefined}
                onClick={() => setIsMobileOpen(false)}
              >
                <item.icon size={20} className={cn(
                  "shrink-0",
                  isActive ? "text-blue-600" : "text-slate-500 group-hover:text-slate-700"
                )} />
                {!sidebarCollapsed && <span>{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer Profile Section */}
        <div className={cn(
          "p-4 border-t border-slate-200",
          sidebarCollapsed ? "flex justify-center" : ""
        )}>
          {sidebarCollapsed ? (
             <button title="Sign out" onClick={() => signOut()} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">{user?.name.slice(0, 2).toUpperCase()}</button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">{user?.name.slice(0, 2).toUpperCase()}</div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
                <p className="truncate text-[10px] text-slate-500">{membership?.role || 'Loading role…'}</p>
              </div>
              <button title="Sign out" onClick={() => signOut()} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-800" aria-label="Sign out"><LogOut size={16} /></button>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-4 sm:p-5">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
