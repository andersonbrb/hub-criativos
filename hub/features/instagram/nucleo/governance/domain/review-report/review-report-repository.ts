import type { ContentPieceId, ReviewReportId } from '@sbs/shared-kernel';
import type { ReviewReport } from './review-report';

export interface ReviewReportRepository {
  findById(id: ReviewReportId): Promise<ReviewReport | null>;
  /** Relatório da revisão mais recente da peça (maior `revisionNumber`). */
  findLatestByContentPiece(contentPieceId: ContentPieceId): Promise<ReviewReport | null>;
  /**
   * Relatório mais recente de uma revisão específica (a legenda editada ganha um novo);
   * garante a idempotência da revisão automática.
   */
  findByRevision(
    contentPieceId: ContentPieceId,
    revisionNumber: number,
  ): Promise<ReviewReport | null>;
  /** Grava com concorrência otimista; lança `ConcurrencyError` se a versão mudou. */
  save(report: ReviewReport): Promise<void>;
}
