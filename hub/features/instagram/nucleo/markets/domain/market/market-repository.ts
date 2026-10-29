import type { MarketId } from '@sbs/shared-kernel';
import type { Market } from './market';

export interface MarketRepository {
  findById(id: MarketId): Promise<Market | null>;
  findByCode(code: string): Promise<Market | null>;
  list(): Promise<Market[]>;
  /** Grava com concorrência otimista; lança `ConcurrencyError` se a versão mudou. */
  save(market: Market): Promise<void>;
}
