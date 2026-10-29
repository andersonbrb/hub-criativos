import type { AdaptableFormat } from '@sbs/shared-kernel';
import type { ReviewCheckProps } from '../../domain';
import type { ReviewMarketProfile } from './content-for-review';

export interface ContentReviewInput {
  format: AdaptableFormat;
  caption: string;
  hashtags: string[];
  sourceCaption: string;
  market: ReviewMarketProfile;
}

/** Códigos das checagens que se espera do revisor de IA. */
export const AI_CHECK_CODES = [
  'translation_fidelity',
  'religious_accuracy',
  'forbidden_claims',
  'brand_tone',
] as const;
export type AiCheckCode = (typeof AI_CHECK_CODES)[number];

/**
 * Revisor de IA: fidelidade da tradução, coerência religiosa, promessas proibidas e tom
 * da marca. Pode falhar (rede, cota, resposta malformada); a revisão segue sem ele.
 */
export interface ContentReviewer {
  review(input: ContentReviewInput): Promise<ReviewCheckProps[]>;
}
