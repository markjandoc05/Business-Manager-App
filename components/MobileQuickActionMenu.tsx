'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

export type MobileQuickAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

export function MobileQuickActionMenu({ items }: { items: MobileQuickAction[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div ref={containerRef} className="mobile-page-quick-action">
      <button
        type="button"
        className="mobile-page-quick-action-trigger"
        aria-label="Quick actions"
        aria-controls="mobile-quick-actions-menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <Plus size={20} aria-hidden="true" />
      </button>
      {open && (
        <div id="mobile-quick-actions-menu" role="menu" aria-label="Quick actions menu" className="mobile-page-quick-actions-menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
