import { MarketId, type Clock, type EventBus, type IdGenerator } from '@sbs/shared-kernel';
import { Market, MarketErrors, type MarketProps, type MarketRepository } from '../../domain';

export class CreateMarket {
  constructor(
    private readonly markets: MarketRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  async execute(input: MarketProps): Promise<Market> {
    if (await this.markets.findByCode(input.code)) throw MarketErrors.marketCodeTaken(input.code);

    const market = Market.create(MarketId(this.ids.next()), input, this.clock.now());
    await this.markets.save(market);
    await this.events.publish(market.pullEvents());
    return market;
  }
}
