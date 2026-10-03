'use client';

import { useEffect, useRef, type RefObject } from 'react';

const dialogStack: symbol[] = [];
let scrollLockCount = 0;
let originalBodyOverflow = '';

const FOCUSABLE = [
  '[autofocus]',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function visibleFocusableElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
}

/** Provides stack-aware focus trapping, Escape handling, scroll lock, and focus restoration. */
export function useDialogAccessibility<T extends HTMLElement>(onClose: () => void, enabled = true, escapeEnabled = true, restoreFocusRef?: RefObject<HTMLElement | null>) {
  const anchorRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const escapeEnabledRef = useRef(escapeEnabled);
  onCloseRef.current = onClose;
  escapeEnabledRef.current = escapeEnabled;

  useEffect(() => {
    if (!enabled || !anchorRef.current) return;
    const dialog = anchorRef.current.matches('[role="dialog"]') ? anchorRef.current : anchorRef.current.closest<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const token = Symbol('dialog');
    const previousFocus = restoreFocusRef?.current || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialogStack.push(token);
    if (scrollLockCount === 0) {
      originalBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scrollLockCount += 1;

    const focusTimer = window.setTimeout(() => {
      if (dialogStack.at(-1) !== token || dialog.contains(document.activeElement)) return;
      (visibleFocusableElements(dialog)[0] || dialog).focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack.at(-1) !== token) return;
      if (event.key === 'Escape' && escapeEnabledRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = visibleFocusableElements(dialog);
      if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      const index = dialogStack.lastIndexOf(token);
      if (index >= 0) dialogStack.splice(index, 1);
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) document.body.style.overflow = originalBodyOverflow;
      if (previousFocus?.isConnected) window.setTimeout(() => previousFocus.focus());
    };
  }, [enabled, restoreFocusRef]);

  return anchorRef;
}
