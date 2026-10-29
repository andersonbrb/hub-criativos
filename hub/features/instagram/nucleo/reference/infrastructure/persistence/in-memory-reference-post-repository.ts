import {
  InMemoryDocumentStore,
  type ReferencePostId,
  type ReferenceSourceId,
} from '@sbs/shared-kernel';
import {
  ReferencePost,
  type ReferencePostFilter,
  type ReferencePostRepository,
  type ReferencePostSnapshot,
} from '../../domain';

export class InMemoryReferencePostRepository implements ReferencePostRepository {
  private readonly store = new InMemoryDocumentStore<ReferencePostSnapshot>('ReferencePost');

  async findById(id: ReferencePostId): Promise<ReferencePost | null> {
    const doc = this.store.get(id);
    return doc ? ReferencePost.fromSnapshot(doc) : null;
  }

  async findBySourceAndExternalId(
    sourceId: ReferenceSourceId,
    externalId: string,
  ): Promise<ReferencePost | null> {
    const [doc] = this.store.find((p) => p.sourceId === sourceId && p.externalId === externalId);
    return doc ? ReferencePost.fromSnapshot(doc) : null;
  }

  async listBySource(sourceId: ReferenceSourceId): Promise<ReferencePost[]> {
    return this.store.find((p) => p.sourceId === sourceId).map(ReferencePost.fromSnapshot);
  }

  async list(filter: ReferencePostFilter = {}): Promise<ReferencePost[]> {
    return this.store
      .find((p) => filter.status === undefined || p.status === filter.status)
      .map(ReferencePost.fromSnapshot);
  }

  async save(post: ReferencePost): Promise<void> {
    post.markPersisted(this.store.put(post.toSnapshot()));
  }
}
