import {
  InMemoryDocumentStore,
  type ContentPieceId,
  type ReviewReportId,
} from '@sbs/shared-kernel';
import { ReviewReport, type ReviewReportRepository, type ReviewReportSnapshot } from '../../domain';

export class InMemoryReviewReportRepository implements ReviewReportRepository {
  private readonly store = new InMemoryDocumentStore<ReviewReportSnapshot>('ReviewReport');

  async findById(id: ReviewReportId): Promise<ReviewReport | null> {
    const doc = this.store.get(id);
    return doc ? ReviewReport.fromSnapshot(doc) : null;
  }

  async findLatestByContentPiece(contentPieceId: ContentPieceId): Promise<ReviewReport | null> {
    const [latest] = this.store
      .find((r) => r.contentPieceId === contentPieceId)
      .sort(
        (a, b) => b.revisionNumber - a.revisionNumber || b.createdAt.localeCompare(a.createdAt),
      );
    return latest ? ReviewReport.fromSnapshot(latest) : null;
  }

  async findByRevision(
    contentPieceId: ContentPieceId,
    revisionNumber: number,
  ): Promise<ReviewReport | null> {
    const [doc] = this.store
      .find((r) => r.contentPieceId === contentPieceId && r.revisionNumber === revisionNumber)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return doc ? ReviewReport.fromSnapshot(doc) : null;
  }

  async save(report: ReviewReport): Promise<void> {
    report.markPersisted(this.store.put(report.toSnapshot()));
  }
}
