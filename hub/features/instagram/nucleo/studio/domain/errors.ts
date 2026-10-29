import { DomainError, type AdaptableFormat } from '@sbs/shared-kernel';
import type { ContentPieceAction, ContentPieceStatus } from './content-piece/content-piece-status';

const STATUS_LABELS: Record<ContentPieceStatus, string> = {
  queued: 'na fila',
  producing: 'em produção',
  ai_review: 'em revisão automática',
  awaiting_approval: 'aguardando aprovação',
  changes_requested: 'com ajustes pedidos',
  approved: 'aprovada',
  scheduled: 'agendada',
  published: 'publicada',
  rejected: 'reprovada',
  failed: 'com falha na produção',
};

const ACTION_LABELS: Record<ContentPieceAction, string> = {
  startProduction: 'iniciar a produção de',
  saveLocalizedCopy: 'salvar a legenda localizada de',
  logProductionStep: 'registrar uma etapa da produção de',
  completeProduction: 'concluir a produção de',
  failProduction: 'registrar falha de produção em',
  recordAutomatedReview: 'registrar a revisão automática de',
  editCaption: 'editar a legenda de',
  approve: 'aprovar',
  reject: 'reprovar',
  requestChanges: 'pedir ajustes em',
  markScheduled: 'agendar',
  markPublished: 'marcar como publicada',
  retryProduction: 'tentar de novo a produção de',
};

const FORMAT_LABELS: Record<AdaptableFormat, string> = { reel: 'reel', carousel: 'carrossel' };

export const StudioErrors = {
  invalidTransition: (from: ContentPieceStatus, action: ContentPieceAction) =>
    new DomainError(
      'invalid_transition',
      `Não é possível ${ACTION_LABELS[action]} uma peça ${STATUS_LABELS[from]}.`,
      { from, action },
    ),
  blockingIssuesUnresolved: () =>
    new DomainError(
      'blocking_issues_unresolved',
      'A revisão automática encontrou problemas bloqueantes. Peça ajustes ou reprove a peça.',
    ),
  assetsMissing: () =>
    new DomainError('assets_missing', 'A peça ainda não tem mídia produzida para aprovar.'),
  assetsFormatMismatch: (expected: AdaptableFormat, received: string) =>
    new DomainError(
      'assets_format_mismatch',
      `A mídia produzida não é de ${FORMAT_LABELS[expected]}, que é o formato da peça.`,
      { expected, received },
    ),
  invalidProductionStep: (reason: string) =>
    new DomainError('invalid_production_step', `Registro de produção inválido: ${reason}`),
  invalidAssets: (reason: string) =>
    new DomainError('invalid_assets', `Mídia produzida inválida: ${reason}`),
  invalidCaption: () => new DomainError('invalid_caption', 'A legenda não pode ficar vazia.'),
  invalidRejectionReason: () =>
    new DomainError(
      'invalid_rejection_reason',
      'Explique o motivo da reprovação (pelo menos 3 caracteres).',
    ),
  invalidChangeSuggestion: () =>
    new DomainError(
      'invalid_change_suggestion',
      'Descreva o ajuste que você quer (pelo menos 3 caracteres).',
    ),
  invalidReviewScore: (score: number) =>
    new DomainError('invalid_review_score', 'A nota da revisão automática deve ir de 0 a 100.', {
      score,
    }),
  corruptedSnapshot: (id: string) =>
    new DomainError('corrupted_content_piece', `A peça ${id} está sem revisões.`, { id }),
};
