import type { ReferencePostId, ReferenceSourceId } from '@sbs/shared-kernel';
import type { ReferencePost, ReferencePostStatus } from './reference-post';

export interface ReferencePostFilter {
  status?: ReferencePostStatus;
}

export interface ReferencePostRepository {
  findById(id: ReferencePostId): Promise<ReferencePost | null>;
  findBySourceAndExternalId(
    sourceId: ReferenceSourceId,
    externalId: string,
  ): Promise<ReferencePost | null>;
  listBySource(sourceId: ReferenceSourceId): Promise<ReferencePost[]>;
  list(filter?: ReferencePostFilter): Promise<ReferencePost[]>;
  /** Grava com concorrência otimista; lança `ConcurrencyError` se a versão mudou. */
  save(post: ReferencePost): Promise<void>;
}
