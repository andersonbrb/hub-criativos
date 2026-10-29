import { InMemoryDocumentStore, type ChannelId, type MarketId } from '@sbs/shared-kernel';
import { Channel, type ChannelRepository, type ChannelSnapshot } from '../../domain';

export class InMemoryChannelRepository implements ChannelRepository {
  private readonly store = new InMemoryDocumentStore<ChannelSnapshot>('Channel');

  async findById(id: ChannelId): Promise<Channel | null> {
    const doc = this.store.get(id);
    return doc ? Channel.fromSnapshot(doc) : null;
  }

  async findByHandle(handle: string): Promise<Channel | null> {
    const normalized = handle.replace(/^@/, '').toLowerCase();
    const [doc] = this.store.find((c) => c.handle === normalized);
    return doc ? Channel.fromSnapshot(doc) : null;
  }

  async findByExternalAccountId(externalAccountId: string): Promise<Channel | null> {
    const [doc] = this.store.find((c) => c.externalAccountId === externalAccountId);
    return doc ? Channel.fromSnapshot(doc) : null;
  }

  async listByMarket(marketId: MarketId): Promise<Channel[]> {
    return this.store.find((c) => c.marketId === marketId).map(Channel.fromSnapshot);
  }

  async list(): Promise<Channel[]> {
    return this.store.all().map(Channel.fromSnapshot);
  }

  async save(channel: Channel): Promise<void> {
    channel.markPersisted(this.store.put(channel.toSnapshot()));
  }
}
