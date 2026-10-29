import { UserId, type Clock, type EventBus, type JobQueue } from '@sbs/shared-kernel';
import type { ContentPiece, ContentPieceRepository } from '../../domain';
import { StudioJobs, type ProduceJobPayload } from '../jobs';
import { loadContentPiece } from '../load-content-piece';

export type ReviewerDecision =
  | { action: 'approve' }
  | { action: 'reject'; reason: string }
  | { action: 'request_changes'; suggestion: string };

export interface DecideOnContentPieceInput {
  contentPieceId: string;
  reviewerId: string;
  decision: ReviewerDecision;
}

/** Decisão do revisor (social media) sobre a revisão atual. */
export class DecideOnContentPiece {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly jobs: JobQueue,
  ) {}

  async execute(input: DecideOnContentPieceInput): Promise<ContentPiece> {
    const piece = await loadContentPiece(this.pieces, input.contentPieceId);
    const reviewer = UserId(input.reviewerId);
    const now = this.clock.now();
    const { decision } = input;

    switch (decision.action) {
      case 'approve':
        piece.approve(reviewer, now);
        break;
      case 'reject':
        piece.reject(reviewer, decision.reason, now);
        break;
      case 'request_changes':
        piece.requestChanges(reviewer, decision.suggestion, now);
        break;
    }

    await this.pieces.save(piece);
    await this.events.publish(piece.pullEvents());
    if (decision.action === 'request_changes') {
      // A nova revisão (com a sugestão) nasce quando o job chama `startProduction`.
      await this.jobs.enqueue<ProduceJobPayload>(StudioJobs.produce, { contentPieceId: piece.id });
    }
    return piece;
  }
}
