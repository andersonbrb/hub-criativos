import type { ContentPieceId, ReferencePostId } from '@sbs/shared-kernel';
import {
  ContentPiece,
  EditingStandard,
  type EditingStandardRepository,
  type EditingStandardSnapshot,
  type ContentPieceFilter,
  type ContentPieceRepository,
  type ContentPieceSnapshot,
} from '@sbs/studio';
import type { Database } from '../database/postgres-document-store';
import { PostgresDocumentStore } from '../database/postgres-document-store';

export class PostgresContentPieceRepository implements ContentPieceRepository {
  private readonly store: PostgresDocumentStore<ContentPieceSnapshot>;

  constructor(db: () => Database) {
    this.store = new PostgresDocumentStore(db, 'studio.content_piece', 'Peça de conteúdo');
  }

  async findById(id: ContentPieceId) {
    const doc = await this.store.get(id);
    return doc ? ContentPiece.fromSnapshot(doc) : null;
  }

  async listByReference(referencePostId: ReferencePostId) {
    return (await this.store.find({ referencePostId })).map(ContentPiece.fromSnapshot);
  }

  async list(filter: ContentPieceFilter = {}) {
    const match: Partial<Record<keyof ContentPieceSnapshot, unknown>> = {};
    if (filter.status) match.status = filter.status;
    if (filter.marketId) match.marketId = filter.marketId;
    const docs = await this.store.find(match);
    return docs
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(ContentPiece.fromSnapshot);
  }

  async save(piece: ContentPiece) {
    piece.markPersisted(await this.store.put(piece.toSnapshot()));
  }
}

export class PostgresEditingStandardRepository implements EditingStandardRepository {
  private readonly store: PostgresDocumentStore<EditingStandardSnapshot>;

  constructor(db: () => Database) {
    this.store = new PostgresDocumentStore(db, 'studio.editing_standard', 'Padrão de Edição');
  }

  async get() {
    const doc = await this.store.get(EditingStandard.ID);
    return doc ? EditingStandard.fromSnapshot(doc) : EditingStandard.initial();
  }

  async save(standard: EditingStandard) {
    standard.markPersisted(await this.store.put(standard.toSnapshot()));
  }
}
