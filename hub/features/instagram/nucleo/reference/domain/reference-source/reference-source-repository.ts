import type { ReferenceSourceId } from '@sbs/shared-kernel';
import type { ReferenceSource } from './reference-source';

export interface ReferenceSourceRepository {
  findById(id: ReferenceSourceId): Promise<ReferenceSource | null>;
  /** Aceita o usuário com ou sem `@`, em qualquer caixa. */
  findByHandle(handle: string): Promise<ReferenceSource | null>;
  list(): Promise<ReferenceSource[]>;
  /** Grava com concorrência otimista; lança `ConcurrencyError` se a versão mudou. */
  save(source: ReferenceSource): Promise<void>;
}
