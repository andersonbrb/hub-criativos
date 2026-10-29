import type { ChannelId, MarketId } from '@sbs/shared-kernel';
import type { Channel } from './channel';

export interface ChannelRepository {
  findById(id: ChannelId): Promise<Channel | null>;
  findByHandle(handle: string): Promise<Channel | null>;
  /** Canal vinculado a esta conta do Instagram (id da conta), se houver. */
  findByExternalAccountId(externalAccountId: string): Promise<Channel | null>;
  listByMarket(marketId: MarketId): Promise<Channel[]>;
  list(): Promise<Channel[]>;
  save(channel: Channel): Promise<void>;
}
