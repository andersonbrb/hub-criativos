import type { AdaptableFormat } from './content-format';
import type { DomainEvent } from './domain-event';
import type { ProductionOptions } from './production-options';

/**
 * Linguagem publicada entre bounded contexts.
 *
 * Cada contexto emite seus próprios eventos de domínio; os listados aqui são os que
 * outros contextos podem assinar. Mudar um payload é uma mudança de contrato: altere
 * aqui e o compilador aponta todos os consumidores.
 */

// ── reference ──────────────────────────────────────────────────────────────
export type ReferencePostSelected = DomainEvent<
  'reference.post_selected',
  {
    referencePostId: string;
    format: AdaptableFormat;
    caption: string;
    permalink: string;
    thumbnailUrl: string;
    mediaUrls: string[];
    /** Escolhas de produção feitas na seleção (ausente: padrões). */
    production?: ProductionOptions;
  }
>;

// ── studio ─────────────────────────────────────────────────────────────────
export type ContentPieceProduced = DomainEvent<
  'studio.content_piece_produced',
  { contentPieceId: string; marketId: string; revisionNumber: number }
>;

export type ContentPieceApproved = DomainEvent<
  'studio.content_piece_approved',
  {
    contentPieceId: string;
    marketId: string;
    channelId: string;
    format: AdaptableFormat;
    approvedBy: string;
  }
>;

export type ContentPieceChangesRequested = DomainEvent<
  'studio.content_piece_changes_requested',
  { contentPieceId: string; requestedBy: string; suggestion: string }
>;

export type ContentPieceRejected = DomainEvent<
  'studio.content_piece_rejected',
  { contentPieceId: string; rejectedBy: string; reason: string }
>;

// ── governance ─────────────────────────────────────────────────────────────
export type AutomatedReviewCompleted = DomainEvent<
  'governance.automated_review_completed',
  {
    reviewReportId: string;
    contentPieceId: string;
    revisionNumber: number;
    score: number;
    hasBlockingIssues: boolean;
  }
>;

/**
 * A legenda editada pelo revisor passou de novo pelas regras e pela IA. Mesmo payload de
 * `automated_review_completed`, mas a peça não muda de estado (continua aguardando aprovação):
 * o studio grava o relatório junto com a edição.
 */
export type CaptionEditReviewed = DomainEvent<
  'governance.caption_edit_reviewed',
  AutomatedReviewCompleted['payload']
>;

// ── publishing ─────────────────────────────────────────────────────────────
export type PublicationScheduled = DomainEvent<
  'publishing.publication_scheduled',
  { publicationId: string; contentPieceId: string; scheduledAt: string }
>;

export type PublicationRescheduled = DomainEvent<
  'publishing.publication_rescheduled',
  { publicationId: string; contentPieceId: string; scheduledAt: string }
>;

export type PublicationPublished = DomainEvent<
  'publishing.publication_published',
  { publicationId: string; contentPieceId: string; permalink: string; publishedAt: string }
>;

export type PublicationFailed = DomainEvent<
  'publishing.publication_failed',
  { publicationId: string; contentPieceId: string; error: string; attempts: number }
>;

export type IntegrationEvent =
  | ReferencePostSelected
  | ContentPieceProduced
  | ContentPieceApproved
  | ContentPieceChangesRequested
  | ContentPieceRejected
  | AutomatedReviewCompleted
  | CaptionEditReviewed
  | PublicationScheduled
  | PublicationRescheduled
  | PublicationPublished
  | PublicationFailed;
