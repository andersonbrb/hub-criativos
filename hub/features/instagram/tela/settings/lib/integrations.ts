import type { IntegrationStatus } from '@sbs/contracts';

const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });

export function formatUsd(value: number): string {
  return usd.format(value);
}

/** Fração usada do limite mensal (0–1); 0 sem limite informado. */
export function usageRatio(usage: NonNullable<IntegrationStatus['usage']>): number {
  if (usage.limitUsd <= 0) return 0;
  return Math.min(1, Math.max(0, usage.usedUsd / usage.limitUsd));
}
