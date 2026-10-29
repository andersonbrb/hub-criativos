import {
  ChannelId,
  MarketId,
  NotFoundError,
  type Clock,
  type EventBus,
  type IdGenerator,
} from '@sbs/shared-kernel';
import {
  Channel,
  MarketErrors,
  type ChannelRepository,
  type MarketRepository,
  type PostingSlot,
} from '../../domain';

export interface CreateChannelInput {
  marketId: string;
  handle: string;
  displayName: string;
  postingPlan?: PostingSlot[];
}

export class CreateChannel {
  constructor(
    private readonly markets: MarketRepository,
    private readonly channels: ChannelRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  async execute(input: CreateChannelInput): Promise<Channel> {
    const marketId = MarketId(input.marketId);
    if (!(await this.markets.findById(marketId)))
      throw new NotFoundError('Mercado', input.marketId);
    if (await this.channels.findByHandle(input.handle))
      throw MarketErrors.handleTaken(input.handle);

    const channel = Channel.create(
      ChannelId(this.ids.next()),
      {
        marketId,
        handle: input.handle,
        displayName: input.displayName,
        ...(input.postingPlan ? { postingPlan: input.postingPlan } : {}),
      },
      this.clock.now(),
    );
    await this.channels.save(channel);
    await this.events.publish(channel.pullEvents());
    return channel;
  }
}
