import type { Channel as ChannelDto, Market as MarketDto } from '@sbs/contracts';
import type { Channel, Market } from '@sbs/markets';

export function toMarketDto(market: Market): MarketDto {
  const s = market.toSnapshot();
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    locale: s.locale,
    timezone: s.timezone,
    productName: s.productName,
    offerUrl: s.offerUrl,
    glossary: s.glossary,
    forbiddenTerms: s.forbiddenTerms,
    status: s.status,
    createdAt: s.createdAt,
  };
}

export function toChannelDto(channel: Channel): ChannelDto {
  const s = channel.toSnapshot();
  return {
    id: s.id,
    marketId: s.marketId,
    platform: s.platform,
    handle: s.handle,
    displayName: s.displayName,
    connectionStatus: s.connectionStatus,
    postingPlan: s.postingPlan,
  };
}
