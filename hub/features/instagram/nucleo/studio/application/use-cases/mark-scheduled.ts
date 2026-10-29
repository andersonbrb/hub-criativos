import { PublicationId, type Clock, type PublicationScheduled } from '@sbs/shared-kernel';
import type { ContentPiece, ContentPieceRepository } from '../../domain';
import { loadContentPiece } from '../load-content-piece';

/** Mesmo payload para `publication_scheduled` e `publication_rescheduled`. */
export type MarkScheduledInput = PublicationScheduled['payload'];

export class MarkScheduled {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: MarkScheduledInput): Promise<ContentPiece> {
    const piece = await loadContentPiece(this.pieces, input.contentPieceId);
    piece.markScheduled(
      {
        publicationId: PublicationId(input.publicationId),
        scheduledAt: new Date(input.scheduledAt),
      },
      this.clock.now(),
    );
    await this.pieces.save(piece);
    return piece;
  }
}
