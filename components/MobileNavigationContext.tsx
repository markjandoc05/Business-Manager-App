'use client';

import React, { createContext, useContext } from 'react';

type MobileNavigationContextValue = {
  openNavigation: () => void;
  isOpen: boolean;
};

const MobileNavigationContext = createContext<MobileNavigationContextValue | null>(null);

export function MobileNavigationProvider({
  children,
  openNavigation,
  isOpen,
}: MobileNavigationContextValue & { children: React.ReactNode }) {
  return (
    <MobileNavigationContext.Provider value={{ openNavigation, isOpen }}>
      {children}
    </MobileNavigationContext.Provider>
  );
}

export function useMobileNavigation() {
  return useContext(MobileNavigationContext);
}
