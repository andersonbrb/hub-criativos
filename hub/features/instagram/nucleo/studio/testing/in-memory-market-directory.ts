import { NotFoundError } from '@sbs/shared-kernel';
import type { AdaptationTarget, MarketDirectory, MarketProfile } from '../application';

/** Diretório de mercados de teste: um canal por mercado, só os ativos viram alvo. */
export class InMemoryMarketDirectory implements MarketDirectory {
  private readonly profiles = new Map<string, { profile: MarketProfile; channelId: string }>();

  constructor(entries: { profile: MarketProfile; channelId: string }[] = []) {
    for (const entry of entries) this.add(entry.profile, entry.channelId);
  }

  add(profile: MarketProfile, channelId: string): this {
    this.profiles.set(profile.marketId, { profile, channelId });
    return this;
  }

  async getProfile(marketId: string): Promise<MarketProfile> {
    const entry = this.profiles.get(marketId);
    if (!entry) throw new NotFoundError('Mercado', marketId);
    return structuredClone(entry.profile);
  }

  async listTargets(): Promise<AdaptationTarget[]> {
    return [...this.profiles.values()]
      .filter((e) => e.profile.status === 'active')
      .map((e) => ({ marketId: e.profile.marketId, channelId: e.channelId }));
  }
}
