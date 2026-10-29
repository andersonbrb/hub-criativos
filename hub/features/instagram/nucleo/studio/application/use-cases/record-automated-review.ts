import type { AutomatedReviewCompleted, Clock, EventBus } from '@sbs/shared-kernel';
import type { ContentPiece, ContentPieceRepository } from '../../domain';
import { loadContentPiece } from '../load-content-piece';

export type RecordAutomatedReviewInput = AutomatedReviewCompleted['payload'];

export class RecordAutomatedReview {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  /** Devolve a peça como ficou; relatórios atrasados ou repetidos não mudam nada. */
  async execute(input: RecordAutomatedReviewInput): Promise<ContentPiece> {
    const piece = await loadContentPiece(this.pieces, input.contentPieceId);

    // Relatório de uma revisão que já foi substituída (o revisor pediu ajustes no meio).
    if (!piece.isCurrentRevision(input.revisionNumber)) return piece;
    // Reentrega do mesmo evento.
    if (piece.currentRevision.automatedReview?.reportId === input.reviewReportId) return piece;

    piece.recordAutomatedReview(
      {
        reportId: input.reviewReportId,
        score: input.score,
        hasBlockingIssues: input.hasBlockingIssues,
      },
      this.clock.now(),
    );
    await this.pieces.save(piece);
    await this.events.publish(piece.pullEvents());
    return piece;
  }
}
