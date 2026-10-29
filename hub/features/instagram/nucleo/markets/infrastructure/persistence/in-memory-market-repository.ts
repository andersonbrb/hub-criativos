import { InMemoryDocumentStore, type MarketId } from '@sbs/shared-kernel';
import { Market, type MarketRepository, type MarketSnapshot } from '../../domain';

export class InMemoryMarketRepository implements MarketRepository {
  private readonly store = new InMemoryDocumentStore<MarketSnapshot>('Market');

  async findById(id: MarketId): Promise<Market | null> {
    const doc = this.store.get(id);
    return doc ? Market.fromSnapshot(doc) : null;
  }

  async findByCode(code: string): Promise<Market | null> {
    const [doc] = this.store.find((m) => m.code === code);
    return doc ? Market.fromSnapshot(doc) : null;
  }

  async list(): Promise<Market[]> {
    return this.store
      .all()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(Market.fromSnapshot);
  }

  async save(market: Market): Promise<void> {
    market.markPersisted(this.store.put(market.toSnapshot()));
  }
}
