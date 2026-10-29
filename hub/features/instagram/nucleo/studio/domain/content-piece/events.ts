import {
  domainEvent,
  type ContentPieceApproved,
  type ContentPieceChangesRequested,
  type ContentPieceProduced,
  type ContentPieceRejected,
  type DomainEvent,
} from '@sbs/shared-kernel';

/** Eventos internos do Estúdio (os de integração vêm do shared-kernel). */
export type ContentPieceCreated = DomainEvent<
  'studio.content_piece_created',
  { contentPieceId: string; referencePostId: string; marketId: string }
>;

export type ContentPieceFailed = DomainEvent<
  'studio.content_piece_failed',
  { contentPieceId: string; reason: string }
>;

export type StudioEvent =
  | ContentPieceCreated
  | ContentPieceFailed
  | ContentPieceProduced
  | ContentPieceApproved
  | ContentPieceChangesRequested
  | ContentPieceRejected;

/**
 * Fábricas tipadas: o payload é checado contra o contrato publicado, então mudar
 * `integration-events.ts` quebra a compilação aqui, não em produção.
 */
export const StudioEvents = {
  created: (at: Date, payload: ContentPieceCreated['payload']): ContentPieceCreated =>
    domainEvent('studio.content_piece_created', at, payload),
  failed: (at: Date, payload: ContentPieceFailed['payload']): ContentPieceFailed =>
    domainEvent('studio.content_piece_failed', at, payload),
  produced: (at: Date, payload: ContentPieceProduced['payload']): ContentPieceProduced =>
    domainEvent('studio.content_piece_produced', at, payload),
  approved: (at: Date, payload: ContentPieceApproved['payload']): ContentPieceApproved =>
    domainEvent('studio.content_piece_approved', at, payload),
  changesRequested: (
    at: Date,
    payload: ContentPieceChangesRequested['payload'],
  ): ContentPieceChangesRequested =>
    domainEvent('studio.content_piece_changes_requested', at, payload),
  rejected: (at: Date, payload: ContentPieceRejected['payload']): ContentPieceRejected =>
    domainEvent('studio.content_piece_rejected', at, payload),
};
