import type { JobQueue } from '@sbs/shared-kernel';
import type { ContentPiece, ContentPieceRepository } from '../../domain';
import { StudioJobs, type ProduceJobPayload } from '../jobs';
import { loadContentPiece } from '../load-content-piece';

export interface RetryProductionInput {
  contentPieceId: string;
}

/** Reenfileira a produção de uma peça que falhou; o job faz o `startProduction`. */
export class RetryProduction {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly jobs: JobQueue,
  ) {}

  async execute(input: RetryProductionInput): Promise<ContentPiece> {
    const piece = await loadContentPiece(this.pieces, input.contentPieceId);
    piece.ensureRetryable();
    await this.jobs.enqueue<ProduceJobPayload>(StudioJobs.produce, { contentPieceId: piece.id });
    return piece;
  }
}
