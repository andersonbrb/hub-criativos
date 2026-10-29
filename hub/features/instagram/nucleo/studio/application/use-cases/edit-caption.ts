import { UserId, type Clock } from '@sbs/shared-kernel';
import type { AutomatedReview, ContentPiece, ContentPieceRepository } from '../../domain';
import { loadContentPiece } from '../load-content-piece';

export interface EditCaptionInput {
  contentPieceId: string;
  editorId: string;
  caption: string;
  hashtags: string[];
  /** Revisão automática refeita sobre o texto editado (montada no composition root). */
  review?: AutomatedReview;
}

export class EditCaption {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: EditCaptionInput): Promise<ContentPiece> {
    const piece = await loadContentPiece(this.pieces, input.contentPieceId);
    piece.editCaption(
      input.caption,
      input.hashtags,
      UserId(input.editorId),
      this.clock.now(),
      input.review ?? null,
    );
    await this.pieces.save(piece);
    return piece;
  }
}
