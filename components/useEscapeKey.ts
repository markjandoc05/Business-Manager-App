import { useEffect, useRef } from 'react';

type EscapeHandler = () => void;

const escapeHandlers: EscapeHandler[] = [];
let escapeListenerAttached = false;

function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  const handler = escapeHandlers[escapeHandlers.length - 1];
  if (!handler) return;

  event.preventDefault();
  handler();
}

export function useEscapeKey(onEscape: EscapeHandler, enabled = true) {
  const callbackRef = useRef(onEscape);

  useEffect(() => {
    callbackRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!enabled) return;

    const handler = () => callbackRef.current();
    escapeHandlers.push(handler);

    if (!escapeListenerAttached) {
      window.addEventListener('keydown', handleEscape);
      escapeListenerAttached = true;
    }

    return () => {
      const index = escapeHandlers.indexOf(handler);
      if (index >= 0) escapeHandlers.splice(index, 1);
      if (escapeHandlers.length === 0 && escapeListenerAttached) {
        window.removeEventListener('keydown', handleEscape);
        escapeListenerAttached = false;
      }
    };
  }, [enabled]);
}
