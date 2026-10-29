import type { ContentPieceId, MarketId, ReferencePostId } from '@sbs/shared-kernel';
import type { ContentPiece } from './content-piece';
import type { ContentPieceStatus } from './content-piece-status';

export interface ContentPieceFilter {
  status?: ContentPieceStatus;
  marketId?: MarketId;
}

export interface ContentPieceRepository {
  findById(id: ContentPieceId): Promise<ContentPiece | null>;
  /** Todas as peças (de todas as rodadas) criadas a partir de um post de referência. */
  listByReference(referencePostId: ReferencePostId): Promise<ContentPiece[]>;
  /** Mais recentes primeiro (`createdAt` decrescente). */
  list(filter?: ContentPieceFilter): Promise<ContentPiece[]>;
  /** Grava com concorrência otimista; lança `ConcurrencyError` se a versão mudou. */
  save(piece: ContentPiece): Promise<void>;
}
