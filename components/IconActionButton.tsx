'use client';

import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!tooltipVisible) return;

    const updateTooltipPosition = () => {
      const button = buttonRef.current;
      const tooltip = tooltipRef.current;
      if (!button || !tooltip) return;

      const buttonRect = button.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const edgePadding = 12;
      const gap = 6;
      const maxLeft = Math.max(edgePadding, window.innerWidth - tooltipRect.width - edgePadding);
      const centeredLeft = buttonRect.left + (buttonRect.width - tooltipRect.width) / 2;
      const left = Math.min(Math.max(centeredLeft, edgePadding), maxLeft);
      const aboveTop = buttonRect.top - tooltipRect.height - gap;
      const belowTop = buttonRect.bottom + gap;
      const top = aboveTop >= edgePadding
        ? aboveTop
        : belowTop + tooltipRect.height <= window.innerHeight - edgePadding
          ? belowTop
          : Math.max(edgePadding, aboveTop);

      setTooltipPosition({ top, left });
    };

    updateTooltipPosition();
    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [tooltipVisible]);

  const variants: Record<IconActionVariant, string> = {
    default: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
    primary: 'text-blue-600 hover:bg-blue-50 hover:text-blue-700',
    danger: 'text-slate-400 hover:bg-red-50 hover:text-red-600',
    success: 'text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700',
  };

  return <span className="group relative inline-flex" onMouseEnter={() => setTooltipVisible(true)} onMouseLeave={() => setTooltipVisible(false)}>
    <button ref={buttonRef} type={type} aria-label={label} aria-describedby={tooltipVisible ? tooltipId : undefined} onFocus={() => setTooltipVisible(true)} onBlur={() => setTooltipVisible(false)} onClick={onClick} onPointerDown={onPointerDown} disabled={disabled} className={cn('inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:pointer-events-none disabled:opacity-40', variants[variant], className)}>
      {icon}
    </button>
    {tooltipVisible && typeof document !== 'undefined' && createPortal(
      <span ref={tooltipRef} id={tooltipId} role="tooltip" style={{ top: tooltipPosition.top, left: tooltipPosition.left }} className="pointer-events-none fixed z-[1000] max-w-[calc(100vw-1.5rem)] overflow-hidden text-ellipsis whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg">
        {label}
      </span>,
      document.body,
    )}
  </span>;
}
