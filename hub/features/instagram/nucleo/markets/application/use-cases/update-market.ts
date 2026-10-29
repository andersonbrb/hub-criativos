import { MarketId, NotFoundError, type EventBus } from '@sbs/shared-kernel';
import type { Market, MarketProps, MarketRepository, MarketStatus } from '../../domain';

export interface UpdateMarketInput extends Partial<Omit<MarketProps, 'code'>> {
  status?: MarketStatus;
}

export class UpdateMarket {
  constructor(
    private readonly markets: MarketRepository,
    private readonly events: EventBus,
  ) {}

  async execute(id: string, input: UpdateMarketInput): Promise<Market> {
    const market = await this.markets.findById(MarketId(id));
    if (!market) throw new NotFoundError('Mercado', id);

    const { status, ...changes } = input;
    market.update(changes);
    if (status === 'paused') market.pause();
    if (status === 'active') market.activate();

    await this.markets.save(market);
    await this.events.publish(market.pullEvents());
    return market;
  }
}
