import {
  ReviewReport,
  type ReviewReportRepository,
  type ReviewReportSnapshot,
} from '@sbs/governance';
import type { ContentPieceId, ReviewReportId } from '@sbs/shared-kernel';
import type { Database } from '../database/postgres-document-store';
import { PostgresDocumentStore } from '../database/postgres-document-store';

export class PostgresReviewReportRepository implements ReviewReportRepository {
  private readonly store: PostgresDocumentStore<ReviewReportSnapshot>;

  constructor(db: () => Database) {
    this.store = new PostgresDocumentStore(db, 'governance.review_report', 'Relatório de revisão');
  }

  async findById(id: ReviewReportId) {
    const doc = await this.store.get(id);
    return doc ? ReviewReport.fromSnapshot(doc) : null;
  }

  async findLatestByContentPiece(contentPieceId: ContentPieceId) {
    const docs = await this.store.find({ contentPieceId });
    const latest = docs.sort(
      (a, b) => b.revisionNumber - a.revisionNumber || b.createdAt.localeCompare(a.createdAt),
    )[0];
    return latest ? ReviewReport.fromSnapshot(latest) : null;
  }

  async findByRevision(contentPieceId: ContentPieceId, revisionNumber: number) {
    // A legenda editada ganha um novo relatório da mesma revisão: vale o mais recente.
    const docs = await this.store.find({ contentPieceId, revisionNumber });
    const [doc] = docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return doc ? ReviewReport.fromSnapshot(doc) : null;
  }

  async save(report: ReviewReport) {
    report.markPersisted(await this.store.put(report.toSnapshot()));
  }
}
