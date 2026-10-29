import { NotFoundError, ReviewReportId } from '@sbs/shared-kernel';
import type { ReviewReport, ReviewReportRepository } from '../../domain';

export class GetReviewReport {
  constructor(private readonly reports: ReviewReportRepository) {}

  async execute(id: string): Promise<ReviewReport> {
    const report = await this.reports.findById(ReviewReportId(id));
    if (!report) throw new NotFoundError('Relatório de revisão', id);
    return report;
  }
}
