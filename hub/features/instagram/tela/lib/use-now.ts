'use client';

import { useEffect, useState } from 'react';

/** Hora atual que se renova a cada `intervalMs` (para "hoje", "há 5 minutos"…). */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
