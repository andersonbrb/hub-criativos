import type { AdaptableFormat } from '@sbs/shared-kernel';
import type { MarketProfile } from './market-directory';

export interface LocalizeCopyInput {
  sourceCaption: string;
  format: AdaptableFormat;
  sourceLocale: string;
  market: MarketProfile;
  /** Sugestão do revisor para esta revisão, se houver. */
  suggestion: string | null;
}

export interface LocalizedCopy {
  caption: string;
  hashtags: string[];
}

/** Adapta a legenda ao idioma, à cultura e à oferta do mercado (hoje falso; depois um agente). */
export interface CopyLocalizer {
  localize(input: LocalizeCopyInput): Promise<LocalizedCopy>;
}
