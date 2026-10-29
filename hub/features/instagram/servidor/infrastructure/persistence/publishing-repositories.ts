import {
  ACTIVE_STATUSES,
  Publication,
  type PublicationListFilter,
  type PublicationRepository,
  type PublicationSnapshot,
  type PublicationStatus,
} from '@sbs/publishing';
import type { ChannelId, ContentPieceId, PublicationId } from '@sbs/shared-kernel';
import type { Database } from '../database/postgres-document-store';
import { PostgresDocumentStore } from '../database/postgres-document-store';

/**
 * Filtros de igualdade vão ao banco (índice GIN); intervalos de data e ordenação
 * ficam em memória — o volume por canal é pequeno (≈3 por dia). Se crescer, ganha
 * um índice de expressão em `data->>'scheduledAt'`.
 */
export class PostgresPublicationRepository implements PublicationRepository {
  private readonly store: PostgresDocumentStore<PublicationSnapshot>;

  constructor(db: () => Database) {
    this.store = new PostgresDocumentStore(db, 'publishing.publication', 'Publicação');
  }

  async findById(id: PublicationId) {
    const doc = await this.store.get(id);
    return doc ? Publication.fromSnapshot(doc) : null;
  }

  async findActiveByContentPiece(contentPieceId: ContentPieceId) {
    const docs = await this.store.find({ contentPieceId });
    const active = docs.find((d) => ACTIVE_STATUSES.includes(d.status));
    return active ? Publication.fromSnapshot(active) : null;
  }

  async listByChannel(channelId: ChannelId, statuses?: readonly PublicationStatus[]) {
    const docs = await this.store.find({ channelId });
    return sortBySchedule(docs.filter((d) => !statuses || statuses.includes(d.status)));
  }

  async findDue(now: Date) {
    const limit = now.getTime();
    const docs = await this.store.find({ status: 'scheduled' });
    return sortBySchedule(docs.filter((d) => Date.parse(d.scheduledAt) <= limit));
  }

  async list(filter: PublicationListFilter = {}) {
    const from = filter.from?.getTime() ?? -Infinity;
    const to = filter.to?.getTime() ?? Infinity;
    const docs = await this.store.find(filter.channelId ? { channelId: filter.channelId } : {});
    return sortBySchedule(
      docs.filter((d) => {
        const at = Date.parse(d.scheduledAt);
        return at >= from && at <= to;
      }),
    );
  }

  async save(publication: Publication) {
    publication.markPersisted(await this.store.put(publication.toSnapshot()));
  }
}

function sortBySchedule(docs: PublicationSnapshot[]): Publication[] {
  return docs
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .map(Publication.fromSnapshot);
}
