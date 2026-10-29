import type { Clock, PublicationPublished } from '@sbs/shared-kernel';
import type { ContentPiece, ContentPieceRepository } from '../../domain';
import { loadContentPiece } from '../load-content-piece';

export type MarkPublishedInput = PublicationPublished['payload'];

export class MarkPublished {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: MarkPublishedInput): Promise<ContentPiece> {
    const piece = await loadContentPiece(this.pieces, input.contentPieceId);
    // Reentrega do evento: já está publicada, nada a fazer.
    if (piece.status === 'published') return piece;

    piece.markPublished(
      { permalink: input.permalink, publishedAt: new Date(input.publishedAt) },
      this.clock.now(),
    );
    await this.pieces.save(piece);
    return piece;
  }
}
