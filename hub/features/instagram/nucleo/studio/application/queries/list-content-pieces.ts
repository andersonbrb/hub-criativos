import { MarketId } from '@sbs/shared-kernel';
import type { ContentPiece, ContentPieceRepository, ContentPieceStatus } from '../../domain';

export interface ListContentPiecesInput {
  status?: ContentPieceStatus;
  marketId?: string;
}

/** Mais recentes primeiro. */
export class ListContentPieces {
  constructor(private readonly pieces: ContentPieceRepository) {}

  execute(input: ListContentPiecesInput = {}): Promise<ContentPiece[]> {
    return this.pieces.list({
      ...(input.status ? { status: input.status } : {}),
      ...(input.marketId ? { marketId: MarketId(input.marketId) } : {}),
    });
  }
}
