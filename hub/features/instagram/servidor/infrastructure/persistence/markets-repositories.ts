import {
  Channel,
  Market,
  type ChannelRepository,
  type ChannelSnapshot,
  type MarketRepository,
  type MarketSnapshot,
} from '@sbs/markets';
import type { ChannelId, MarketId } from '@sbs/shared-kernel';
import type { Database } from '../database/postgres-document-store';
import { PostgresDocumentStore } from '../database/postgres-document-store';

export class PostgresMarketRepository implements MarketRepository {
  private readonly store: PostgresDocumentStore<MarketSnapshot>;

  constructor(db: () => Database) {
    this.store = new PostgresDocumentStore(db, 'markets.market', 'Mercado');
  }

  async findById(id: MarketId) {
    const doc = await this.store.get(id);
    return doc ? Market.fromSnapshot(doc) : null;
  }

  async findByCode(code: string) {
    const [doc] = await this.store.find({ code });
    return doc ? Market.fromSnapshot(doc) : null;
  }

  async list() {
    return (await this.store.find()).map(Market.fromSnapshot);
  }

  async save(market: Market) {
    market.markPersisted(await this.store.put(market.toSnapshot()));
  }
}

export class PostgresChannelRepository implements ChannelRepository {
  private readonly store: PostgresDocumentStore<ChannelSnapshot>;

  constructor(db: () => Database) {
    this.store = new PostgresDocumentStore(db, 'markets.channel', 'Canal');
  }

  async findById(id: ChannelId) {
    const doc = await this.store.get(id);
    return doc ? Channel.fromSnapshot(doc) : null;
  }

  async findByHandle(handle: string) {
    const [doc] = await this.store.find({ handle: handle.replace(/^@/, '').toLowerCase() });
    return doc ? Channel.fromSnapshot(doc) : null;
  }

  async findByExternalAccountId(externalAccountId: string) {
    const [doc] = await this.store.find({ externalAccountId });
    return doc ? Channel.fromSnapshot(doc) : null;
  }

  async listByMarket(marketId: MarketId) {
    return (await this.store.find({ marketId })).map(Channel.fromSnapshot);
  }

  async list() {
    return (await this.store.find()).map(Channel.fromSnapshot);
  }

  async save(channel: Channel) {
    channel.markPersisted(await this.store.put(channel.toSnapshot()));
  }
}
