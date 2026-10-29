import { ContentPieceId } from '@sbs/shared-kernel';
import type { ReviewReport, ReviewReportRepository } from '../../domain';

/** Relatório da revisão mais recente da peça; `null` se ela ainda não passou pela revisão automática. */
export class GetLatestReviewReport {
  constructor(private readonly reports: ReviewReportRepository) {}

  async execute(contentPieceId: string): Promise<ReviewReport | null> {
    return this.reports.findLatestByContentPiece(ContentPieceId(contentPieceId));
  }
}
