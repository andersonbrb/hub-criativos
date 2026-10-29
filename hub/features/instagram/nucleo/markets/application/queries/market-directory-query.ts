import { MarketId, NotFoundError, type AdaptableFormat } from '@sbs/shared-kernel';
import type { ChannelRepository, MarketRepository } from '../../domain';

export interface MarketProfile {
  marketId: string;
  name: string;
  locale: string;
  timezone: string;
  productName: string;
  offerUrl: string;
  glossary: { source: string; target: string }[];
  forbiddenTerms: string[];
  status: 'active' | 'paused';
}

export interface PublishingTarget {
  marketId: string;
  channelId: string;
  locale: string;
  timezone: string;
  externalAccountId: string | null;
  postingPlan: { localTime: string; format: AdaptableFormat }[];
}

/**
 * Leitura somente-consulta que o contexto de Mercados oferece aos outros.
 * O composition root adapta esta classe às portas de studio, governance e publishing.
 */
export class MarketDirectoryQuery {
  constructor(
    private readonly markets: MarketRepository,
    private readonly channels: ChannelRepository,
  ) {}

  async getProfile(marketId: string): Promise<MarketProfile> {
    const market = await this.markets.findById(MarketId(marketId));
    if (!market) throw new NotFoundError('Mercado', marketId);
    return {
      marketId: market.id,
      name: market.name,
      locale: market.locale,
      timezone: market.timezone,
      productName: market.productName,
      offerUrl: market.offerUrl,
      glossary: market.glossary.map((t) => ({ ...t })),
      forbiddenTerms: [...market.forbiddenTerms],
      status: market.status,
    };
  }

  /** Um item por canal de cada mercado ativo. */
  async listActiveTargets(): Promise<PublishingTarget[]> {
    const markets = (await this.markets.list()).filter((m) => m.isActive);
    const targets: PublishingTarget[] = [];
    for (const market of markets) {
      // Canal conectado primeiro: com mais de uma conta no mercado, é nele que se publica.
      const channels = (await this.channels.listByMarket(market.id)).sort(
        (x, y) =>
          Number(y.connectionStatus === 'connected') - Number(x.connectionStatus === 'connected'),
      );
      for (const channel of channels) {
        targets.push(this.toTarget(market, channel));
      }
    }
    return targets;
  }

  async getTargetByChannel(channelId: string): Promise<PublishingTarget> {
    const channel = (await this.channels.list()).find((c) => c.id === channelId);
    if (!channel) throw new NotFoundError('Canal', channelId);
    const market = await this.markets.findById(channel.marketId);
    if (!market) throw new NotFoundError('Mercado', channel.marketId);
    return this.toTarget(market, channel);
  }

  private toTarget(
    market: { id: string; locale: string; timezone: string },
    channel: {
      id: string;
      externalAccountId: string | null;
      postingPlan: { slots: readonly { localTime: string; format: AdaptableFormat }[] };
    },
  ): PublishingTarget {
    return {
      marketId: market.id,
      channelId: channel.id,
      locale: market.locale,
      timezone: market.timezone,
      externalAccountId: channel.externalAccountId,
      postingPlan: channel.postingPlan.slots.map((s) => ({ ...s })),
    };
  }
}
