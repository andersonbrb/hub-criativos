export interface PollingOptions {
  fetch?: typeof fetch;
  /** Espera entre consultas de andamento (testes usam 0). */
  sleep?: (ms: number) => Promise<void>;
  pollMs?: number;
  timeoutMs?: number;
}
