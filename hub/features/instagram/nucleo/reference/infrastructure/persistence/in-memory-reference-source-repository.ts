import { InMemoryDocumentStore, type ReferenceSourceId } from '@sbs/shared-kernel';
import {
  ReferenceSource,
  type ReferenceSourceRepository,
  type ReferenceSourceSnapshot,
} from '../../domain';

export class InMemoryReferenceSourceRepository implements ReferenceSourceRepository {
  private readonly store = new InMemoryDocumentStore<ReferenceSourceSnapshot>('ReferenceSource');

  async findById(id: ReferenceSourceId): Promise<ReferenceSource | null> {
    const doc = this.store.get(id);
    return doc ? ReferenceSource.fromSnapshot(doc) : null;
  }

  async findByHandle(handle: string): Promise<ReferenceSource | null> {
    const normalized = handle.trim().replace(/^@/, '').toLowerCase();
    const [doc] = this.store.find((s) => s.handle === normalized);
    return doc ? ReferenceSource.fromSnapshot(doc) : null;
  }

  async list(): Promise<ReferenceSource[]> {
    return this.store
      .all()
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .map(ReferenceSource.fromSnapshot);
  }

  async save(source: ReferenceSource): Promise<void> {
    source.markPersisted(this.store.put(source.toSnapshot()));
  }
}
