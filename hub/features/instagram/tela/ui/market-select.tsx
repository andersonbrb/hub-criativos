'use client';

import type { Market } from '@sbs/contracts';
import { cn } from '@/features/instagram/tela/lib/cn';
import { Select } from './input';

/** Filtro de mercado ("Todos os mercados" + lista). */
export function MarketSelect({
  markets,
  value,
  onChange,
  className,
}: {
  markets: readonly Market[];
  value: string;
  onChange: (marketId: string) => void;
  className?: string;
}) {
  return (
    <Select
      aria-label="Filtrar por mercado"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn('w-auto min-w-48', className)}
    >
      <option value="">Todos os mercados</option>
      {markets.map((market) => (
        <option key={market.id} value={market.id}>
          {market.name}
        </option>
      ))}
    </Select>
  );
}
