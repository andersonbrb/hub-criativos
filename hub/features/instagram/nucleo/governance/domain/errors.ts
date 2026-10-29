import { DomainError } from '@sbs/shared-kernel';

export const GovernanceErrors = {
  invalidReviewCheck: (reason: string, details: Record<string, unknown> = {}) =>
    new DomainError('invalid_review_check', `Checagem de revisão inválida: ${reason}`, details),
  duplicateReviewCheck: (code: string) =>
    new DomainError(
      'duplicate_review_check',
      `A checagem "${code}" aparece duas vezes no relatório de revisão.`,
      { code },
    ),
  emptyReviewReport: () =>
    new DomainError(
      'empty_review_report',
      'O relatório de revisão precisa de pelo menos uma checagem.',
    ),
  invalidRevisionNumber: (revisionNumber: number) =>
    new DomainError(
      'invalid_revision_number',
      'O número da revisão deve ser um inteiro maior que zero.',
      { revisionNumber },
    ),
  /** `checks`: as checagens bloqueantes (`ReviewCheckProps`), que vão nos detalhes do erro. */
  captionBlockedByRules: (checks: readonly { message: string }[]) =>
    new DomainError(
      'caption_blocked_by_rules',
      `A edição não passou nas regras: ${checks.map((c) => c.message).join(' ')}`,
      { checks },
    ),
};
