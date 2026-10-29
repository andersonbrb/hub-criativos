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
  normalizeChannelHandle,
  type ChannelRepository,
  type MarketRepository,
} from '../../domain';

export interface LinkInstagramAccountInput {
  /** Mercado (país) escolhido para a conta. */
  marketId: string;
  /** @ informado pelo Instagram no login. */
  username: string;
  /** Id da conta no Instagram. */
  externalAccountId: string;
}

/**
 * Liga a conta do Instagram que acabou de fazer login a um canal do mercado escolhido. O @ vem
 * do Instagram. Reaproveita, nesta ordem: o canal já ligado a esta conta; o canal com o mesmo @;
 * um canal do mercado que nunca foi conectado (o provisório da configuração inicial). Sem
 * nenhum, cria o canal com a grade padrão.
 */
export class LinkInstagramAccount {
  constructor(
    private readonly markets: MarketRepository,
    private readonly channels: ChannelRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  async execute(input: LinkInstagramAccountInput): Promise<Channel> {
    const marketId = MarketId(input.marketId);
    if (!(await this.markets.findById(marketId)))
      throw new NotFoundError('Mercado', input.marketId);
    const handle = normalizeChannelHandle(input.username);

    const channel =
      (await this.channels.findByExternalAccountId(input.externalAccountId)) ??
      (await this.channels.findByHandle(handle)) ??
      (await this.channels.listByMarket(marketId)).find((c) => c.externalAccountId === null) ??
      Channel.create(
        ChannelId(this.ids.next()),
        { marketId, handle, displayName: handle },
        this.clock.now(),
      );

    // Outro canal já usa este @ (sobra de um cadastro antigo): não dá para ter dois.
    const sameHandle = await this.channels.findByHandle(handle);
    if (sameHandle && sameHandle.id !== channel.id) throw MarketErrors.handleTaken(handle);

    channel.linkInstagramAccount(handle, input.externalAccountId);
    if (channel.marketId !== marketId) channel.moveToMarket(marketId);
    await this.channels.save(channel);
    await this.events.publish(channel.pullEvents());
    return channel;
  }
}
