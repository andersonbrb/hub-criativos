import type { Market } from '@sbs/contracts';

/** Rótulo curto do mercado para chips: região do locale ("FR"), "LATAM" para 419, senão o código. */
export function marketShortLabel(market: Pick<Market, 'code' | 'locale'>): string {
  const region = market.locale.split('-')[1];
  if (region && /^[A-Za-z]{2}$/.test(region)) return region.toUpperCase();
  if (region === '419') return 'LATAM';
  return market.code.slice(0, 5).toUpperCase();
}

/** Matiz estável (0–359) por mercado, para diferenciar mercados em chips e no calendário. */
export function marketHue(code: string): number {
  let hash = 7;
  for (const char of code) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

/** Nome do idioma do locale em português: "fr-FR" → "francês (França)". */
export function localeDisplayName(locale: string): string {
  try {
    const names = new Intl.DisplayNames(['pt-BR'], { type: 'language' });
    return names.of(locale) ?? locale;
  } catch {
    return locale;
  }
}

export type MarketIndex = ReadonlyMap<string, Market>;

export function indexMarkets(markets: readonly Market[] | undefined): MarketIndex {
  return new Map((markets ?? []).map((market) => [market.id, market]));
}
