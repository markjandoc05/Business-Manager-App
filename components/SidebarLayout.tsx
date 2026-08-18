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
  Menu, 
  ChevronLeft,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';

const sidebarItems = [
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

  return (
    <div className="flex h-screen bg-[#F8FAFC] text-slate-800 antialiased">
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
          width: isCollapsed ? '80px' : '260px',
          x: isMobileOpen || isDesktop ? 0 : -260
        }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-[#0F172A] text-slate-300 transition-all duration-300 ease-in-out lg:relative border-r border-slate-800",
          isCollapsed ? "items-center" : "items-stretch"
        )}
      >
        {/* Logo Section */}
        <div className={cn(
          "flex items-center h-16 px-6 border-b border-slate-800",
          isCollapsed ? "justify-center" : "justify-between"
        )}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 bg-blue-500 rounded-lg shadow-lg">
              <Briefcase size={18} className="text-white" />
            </div>
            {!isCollapsed && (
              <span className="text-lg font-bold tracking-tight text-white">Summit Agency</span>
            )}
          </div>
          {!isCollapsed && (
            <button 
              onClick={() => setIsCollapsed(true)}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-800 lg:flex hidden"
            >
              <ChevronLeft size={18} />
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {sidebarItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 group",
                  isActive 
                    ? "bg-blue-600/10 text-blue-400 font-medium" 
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                )}
                onClick={() => setIsMobileOpen(false)}
              >
                <item.icon size={20} className={cn(
                  "shrink-0",
                  isActive ? "text-blue-400" : "text-slate-500 group-hover:text-slate-300"
                )} />
                {!isCollapsed && <span className="text-sm">{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer Profile Section */}
        <div className={cn(
          "p-4 border-t border-slate-800",
          isCollapsed ? "flex justify-center" : ""
        )}>
          {isCollapsed ? (
             <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white">AD</div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white">AD</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">Admin User</p>
                <p className="text-xs text-slate-500 truncate">Manager</p>
              </div>
            </div>
          )}
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between h-16 px-8 bg-white border-b border-slate-200">
          <div className="flex items-center">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsMobileOpen(true)}
                className="p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100 lg:hidden"
              >
                <Menu size={24} />
              </button>
              <h2 className="text-xl font-bold text-slate-900">
                {sidebarItems.find(i => i.href === pathname)?.name || 'Dashboard'}
              </h2>
              <span className="mx-4 text-slate-300 hidden sm:inline">|</span>
              <span className="text-xs text-slate-500 hidden sm:inline">v1.2.0-stable</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
             <div className="relative hidden md:block">
                <input 
                  type="text" 
                  placeholder="Quick search..." 
                  className="w-64 pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" 
                />
                <div className="absolute left-3 top-2.5 w-4 h-4 border-2 border-slate-400 rounded-full"></div>
             </div>
             <button className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-blue-700 active:scale-95 transition-all">
               + New Lead
             </button>
          </div>
        </header>

        {/* Page Body */}
        <main className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
