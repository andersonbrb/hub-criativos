import type { ReviewCheckProps } from '../../domain';
import type { ProductionNote, ReviewableContent } from './content-for-review';

export const GENERAL_REVIEW_CODE = 'general_review';

export type GeneralReviewInput = Pick<
  ReviewableContent,
  'format' | 'caption' | 'hashtags' | 'sourceCaption' | 'market' | 'assets'
> & { production: ProductionNote[] };

/**
 * Revisor geral: olha a peça inteira como o seguidor vai ver (mídia final + legenda) e o que
 * cada agente e revisor da produção relatou. Devolve uma checagem `general_review`, ou `null`
 * quando não está disponível (IA não conectada).
 */
export interface GeneralReviewer {
  review(input: GeneralReviewInput): Promise<ReviewCheckProps | null>;
}
