import {
  InMemoryDocumentStore,
  type ChannelId,
  type ContentPieceId,
  type PublicationId,
} from '@sbs/shared-kernel';
import {
  ACTIVE_STATUSES,
  Publication,
  type PublicationListFilter,
  type PublicationRepository,
  type PublicationSnapshot,
  type PublicationStatus,
} from '../../domain';

export class InMemoryPublicationRepository implements PublicationRepository {
  private readonly store = new InMemoryDocumentStore<PublicationSnapshot>('Publication');

  async findById(id: PublicationId): Promise<Publication | null> {
    const doc = this.store.get(id);
    return doc ? Publication.fromSnapshot(doc) : null;
  }

  async findActiveByContentPiece(contentPieceId: ContentPieceId): Promise<Publication | null> {
    const [doc] = this.store.find(
      (p) => p.contentPieceId === contentPieceId && ACTIVE_STATUSES.includes(p.status),
    );
    return doc ? Publication.fromSnapshot(doc) : null;
  }

  async listByChannel(
    channelId: ChannelId,
    statuses?: readonly PublicationStatus[],
  ): Promise<Publication[]> {
    return this.query(
      (p) => p.channelId === channelId && (!statuses || statuses.includes(p.status)),
    );
  }

  async findDue(now: Date): Promise<Publication[]> {
    const limit = now.getTime();
    return this.query((p) => p.status === 'scheduled' && Date.parse(p.scheduledAt) <= limit);
  }

  async list(filter: PublicationListFilter = {}): Promise<Publication[]> {
    const from = filter.from?.getTime() ?? -Infinity;
    const to = filter.to?.getTime() ?? Infinity;
    return this.query((p) => {
      const at = Date.parse(p.scheduledAt);
      return at >= from && at <= to && (!filter.channelId || p.channelId === filter.channelId);
    });
  }

  async save(publication: Publication): Promise<void> {
    publication.markPersisted(this.store.put(publication.toSnapshot()));
  }

  private query(predicate: (doc: PublicationSnapshot) => boolean): Publication[] {
    return this.store
      .find(predicate)
      .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
      .map(Publication.fromSnapshot);
  }
}
