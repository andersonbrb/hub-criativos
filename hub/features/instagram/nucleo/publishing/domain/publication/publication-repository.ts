import type { ChannelId, ContentPieceId, PublicationId } from '@sbs/shared-kernel';
import type { Publication } from './publication';
import type { PublicationStatus } from './publication-status';

export interface PublicationListFilter {
  /** Inclusivo, sobre `scheduledAt`. */
  from?: Date;
  /** Inclusivo, sobre `scheduledAt`. */
  to?: Date;
  channelId?: ChannelId;
}

export interface PublicationRepository {
  findById(id: PublicationId): Promise<Publication | null>;
  /** A publicação não cancelada da peça, se houver (no máximo uma). */
  findActiveByContentPiece(contentPieceId: ContentPieceId): Promise<Publication | null>;
  /** Sem `statuses`, devolve todas as do canal. Ordenadas por `scheduledAt`. */
  listByChannel(
    channelId: ChannelId,
    statuses?: readonly PublicationStatus[],
  ): Promise<Publication[]>;
  /** `scheduled` com `scheduledAt ≤ now`, mais antigas primeiro. */
  findDue(now: Date): Promise<Publication[]>;
  /** Ordenadas por `scheduledAt`. */
  list(filter?: PublicationListFilter): Promise<Publication[]>;
  /** Grava com concorrência otimista; lança `ConcurrencyError` se a versão mudou. */
  save(publication: Publication): Promise<void>;
}
