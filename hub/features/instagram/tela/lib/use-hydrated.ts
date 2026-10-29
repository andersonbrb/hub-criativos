'use client';

import { useSyncExternalStore } from 'react';

const noop = () => () => undefined;

/**
 * `false` no servidor e na hidratação, `true` depois. Use para partes que dependem do
 * fuso ou do relógio do navegador e não podem divergir do HTML do servidor.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
