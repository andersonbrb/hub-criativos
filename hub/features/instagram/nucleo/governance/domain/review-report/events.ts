import {
  domainEvent,
  type AutomatedReviewCompleted,
  type CaptionEditReviewed,
} from '@sbs/shared-kernel';

export type { AutomatedReviewCompleted, CaptionEditReviewed };

/** `governance.automated_review_completed`: o studio libera a peça para o revisor humano. */
export function automatedReviewCompleted(
  occurredAt: Date,
  payload: AutomatedReviewCompleted['payload'],
): AutomatedReviewCompleted {
  return domainEvent('governance.automated_review_completed', occurredAt, payload);
}

/** `governance.caption_edit_reviewed`: a legenda editada pelo revisor foi revisada de novo. */
export function captionEditReviewed(
  occurredAt: Date,
  payload: CaptionEditReviewed['payload'],
): CaptionEditReviewed {
  return domainEvent('governance.caption_edit_reviewed', occurredAt, payload);
}
