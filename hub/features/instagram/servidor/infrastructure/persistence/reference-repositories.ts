import {
  ReferencePost,
  ReferenceSource,
  normalizeHandle,
  type ReferencePostFilter,
  type ReferencePostRepository,
  type ReferencePostSnapshot,
  type ReferenceSourceRepository,
  type ReferenceSourceSnapshot,
} from '@sbs/reference';
import type { ReferencePostId, ReferenceSourceId } from '@sbs/shared-kernel';
import type { Database } from '../database/postgres-document-store';
import { PostgresDocumentStore } from '../database/postgres-document-store';

export class PostgresReferenceSourceRepository implements ReferenceSourceRepository {
  private readonly store: PostgresDocumentStore<ReferenceSourceSnapshot>;

  constructor(db: () => Database) {
    this.store = new PostgresDocumentStore(db, 'reference.source', 'Conta de referência');
  }

  async findById(id: ReferenceSourceId) {
    const doc = await this.store.get(id);
    return doc ? ReferenceSource.fromSnapshot(doc) : null;
  }

  async findByHandle(handle: string) {
    const [doc] = await this.store.find({ handle: normalizeHandle(handle) });
    return doc ? ReferenceSource.fromSnapshot(doc) : null;
  }

  async list() {
    return (await this.store.find()).map(ReferenceSource.fromSnapshot);
  }

  async save(source: ReferenceSource) {
    source.markPersisted(await this.store.put(source.toSnapshot()));
  }
}

export class PostgresReferencePostRepository implements ReferencePostRepository {
  private readonly store: PostgresDocumentStore<ReferencePostSnapshot>;

  constructor(db: () => Database) {
    this.store = new PostgresDocumentStore(db, 'reference.post', 'Post de referência');
  }

  async findById(id: ReferencePostId) {
    const doc = await this.store.get(id);
    return doc ? ReferencePost.fromSnapshot(doc) : null;
  }

  async findBySourceAndExternalId(sourceId: ReferenceSourceId, externalId: string) {
    const [doc] = await this.store.find({ sourceId, externalId });
    return doc ? ReferencePost.fromSnapshot(doc) : null;
  }

  async listBySource(sourceId: ReferenceSourceId) {
    return (await this.store.find({ sourceId })).map(ReferencePost.fromSnapshot);
  }

  async list(filter: ReferencePostFilter = {}) {
    const match = filter.status ? { status: filter.status } : {};
    return (await this.store.find(match)).map(ReferencePost.fromSnapshot);
  }

  async save(post: ReferencePost) {
    post.markPersisted(await this.store.put(post.toSnapshot()));
  }
}
