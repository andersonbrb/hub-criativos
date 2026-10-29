'use client';

import { useEffect, useRef } from 'react';

export interface ReviewShortcutHandlers {
  onApprove: () => void;
  onRequestChanges: () => void;
  onReject: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Atalhos da revisão: A aprova, J pede ajustes, R reprova.
 * Ignorados enquanto se digita, com modificadores ou quando `enabled` é falso.
 */
export function useReviewShortcuts(enabled: boolean, handlers: ReviewShortcutHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        event.preventDefault();
        ref.current.onApprove();
      } else if (key === 'j') {
        event.preventDefault();
        ref.current.onRequestChanges();
      } else if (key === 'r') {
        event.preventDefault();
        ref.current.onReject();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
