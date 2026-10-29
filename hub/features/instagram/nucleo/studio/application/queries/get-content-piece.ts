import type { ContentPiece, ContentPieceRepository } from '../../domain';
import { loadContentPiece } from '../load-content-piece';

export class GetContentPiece {
  constructor(private readonly pieces: ContentPieceRepository) {}

  execute(id: string): Promise<ContentPiece> {
    return loadContentPiece(this.pieces, id);
  }
}
