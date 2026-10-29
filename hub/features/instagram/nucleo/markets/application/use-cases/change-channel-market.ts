import { ChannelId, MarketId, NotFoundError } from '@sbs/shared-kernel';
import type { Channel, ChannelRepository, MarketRepository } from '../../domain';

/** O usuário escolhe a qual mercado (país) pertence a conta do Instagram. */
export class ChangeChannelMarket {
  constructor(
    private readonly markets: MarketRepository,
    private readonly channels: ChannelRepository,
  ) {}

  async execute(input: { channelId: string; marketId: string }): Promise<Channel> {
    const channel = await this.channels.findById(ChannelId(input.channelId));
    if (!channel) throw new NotFoundError('Canal', input.channelId);
    const marketId = MarketId(input.marketId);
    if (!(await this.markets.findById(marketId)))
      throw new NotFoundError('Mercado', input.marketId);

    if (channel.marketId === marketId) return channel;
    channel.moveToMarket(marketId);
    await this.channels.save(channel);
    return channel;
  }
}
