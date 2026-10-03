'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** Mobile presentation only: callers retain their existing selection and routing. */
export function MobileNavigationTabs({ as = 'div', activeKey, className, children, ...props }: {
  as?: 'div' | 'nav' | 'aside';
  activeKey: string;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const containerRef = useRef<HTMLElement>(null);

  const reveal = useCallback((target: HTMLElement) => {
    const container = containerRef.current;
    if (!container || !window.matchMedia('(max-width: 767px)').matches) return;
    const bounds = container.getBoundingClientRect();
    const tab = target.getBoundingClientRect();
    // Move only the tab strip, never the surrounding page or dialog.
    if (tab.left < bounds.left) container.scrollLeft -= bounds.left - tab.left;
    else if (tab.right > bounds.right) container.scrollLeft += tab.right - bounds.right;
  }, []);

  useEffect(() => {
    const revealSelected = () => {
      const selected = containerRef.current?.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="page"], [aria-pressed="true"]');
      if (selected) reveal(selected);
    };
    const frame = requestAnimationFrame(revealSelected);
    window.addEventListener('resize', revealSelected);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', revealSelected);
    };
  }, [activeKey, reveal]);

  return React.createElement(as, {
    ...props,
    ref: containerRef,
    className: cn('mobile-navigation-tabs', className),
    onFocusCapture: (event: React.FocusEvent<HTMLElement>) => {
      props.onFocusCapture?.(event);
      if (event.target instanceof HTMLElement) reveal(event.target);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      props.onKeyDown?.(event);
      if (event.defaultPrevented || !window.matchMedia('(max-width: 767px)').matches
        || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = tabs.indexOf(event.target as HTMLButtonElement);
      if (index < 0 || tabs.length === 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus({ preventScroll: true });
      reveal(tabs[next]);
      // Enter/Space continue to use the caller's existing click handler.
    },
  }, children);
}
