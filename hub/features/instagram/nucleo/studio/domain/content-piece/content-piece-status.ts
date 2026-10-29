export const CONTENT_PIECE_STATUSES = [
  'queued',
  'producing',
  'ai_review',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'failed',
] as const;

export type ContentPieceStatus = (typeof CONTENT_PIECE_STATUSES)[number];

/**
 * Status em que a adaptação terminou: reprovada pelo revisor ou já publicada. Com todas as
 * adaptações de um post encerradas, o post pode ser selecionado de novo (nova rodada).
 */
export const CLOSED_CONTENT_PIECE_STATUSES = [
  'rejected',
  'published',
] as const satisfies readonly ContentPieceStatus[];

export function isOpenContentPieceStatus(status: ContentPieceStatus): boolean {
  return !(CLOSED_CONTENT_PIECE_STATUSES as readonly ContentPieceStatus[]).includes(status);
}

/** Operações do agregado, usadas em `invalid_transition` (`details.action`). */
export type ContentPieceAction =
  | 'startProduction'
  | 'saveLocalizedCopy'
  | 'logProductionStep'
  | 'completeProduction'
  | 'failProduction'
  | 'recordAutomatedReview'
  | 'editCaption'
  | 'approve'
  | 'reject'
  | 'requestChanges'
  | 'markScheduled'
  | 'markPublished'
  | 'retryProduction';
