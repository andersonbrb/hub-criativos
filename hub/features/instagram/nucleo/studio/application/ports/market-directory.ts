/** Perfil de um mercado, como o Estúdio precisa dele para adaptar conteúdo. */
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

/** Para onde uma peça vai: um canal de um mercado ativo. */
export interface AdaptationTarget {
  marketId: string;
  channelId: string;
}

/** Leitura dos Mercados. Ligada no composition root sobre `@sbs/markets`. */
export interface MarketDirectory {
  getProfile(marketId: string): Promise<MarketProfile>;
  /** Só mercados ativos. */
  listTargets(): Promise<AdaptationTarget[]>;
}
