import {
  InMemoryDocumentStore,
  type ContentPieceId,
  type ReferencePostId,
} from '@sbs/shared-kernel';
import {
  ContentPiece,
  type ContentPieceFilter,
  type ContentPieceRepository,
  type ContentPieceSnapshot,
} from '../../domain';

export class InMemoryContentPieceRepository implements ContentPieceRepository {
  private readonly store = new InMemoryDocumentStore<ContentPieceSnapshot>('ContentPiece');

  async findById(id: ContentPieceId): Promise<ContentPiece | null> {
    const doc = this.store.get(id);
    return doc ? ContentPiece.fromSnapshot(doc) : null;
  }

  async listByReference(referencePostId: ReferencePostId): Promise<ContentPiece[]> {
    return this.store
      .find((p) => p.referencePostId === referencePostId)
      .map((doc) => ContentPiece.fromSnapshot(doc));
  }

  async list(filter: ContentPieceFilter = {}): Promise<ContentPiece[]> {
    return (
      this.store
        .find(
          (p) =>
            (filter.status === undefined || p.status === filter.status) &&
            (filter.marketId === undefined || p.marketId === filter.marketId),
        )
        // Inverte a ordem de inserção antes da ordenação estável: empates saem do mais novo.
        .reverse()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(ContentPiece.fromSnapshot)
    );
  }

  async save(piece: ContentPiece): Promise<void> {
    piece.markPersisted(this.store.put(piece.toSnapshot()));
  }
}
