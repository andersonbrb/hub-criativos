import {
  domainEvent,
  type PublicationFailed,
  type PublicationPublished,
  type PublicationRescheduled,
  type PublicationScheduled,
} from '@sbs/shared-kernel';

/**
 * Eventos de Publicação. Os tipos vêm de `integration-events.ts` (linguagem publicada):
 * o estúdio assina os quatro para acompanhar a peça.
 */

export function publicationScheduled(
  now: Date,
  p: { publicationId: string; contentPieceId: string; scheduledAt: Date },
): PublicationScheduled {
  return domainEvent('publishing.publication_scheduled', now, {
    publicationId: p.publicationId,
    contentPieceId: p.contentPieceId,
    scheduledAt: p.scheduledAt.toISOString(),
  });
}

export function publicationRescheduled(
  now: Date,
  p: { publicationId: string; contentPieceId: string; scheduledAt: Date },
): PublicationRescheduled {
  return domainEvent('publishing.publication_rescheduled', now, {
    publicationId: p.publicationId,
    contentPieceId: p.contentPieceId,
    scheduledAt: p.scheduledAt.toISOString(),
  });
}

export function publicationPublished(
  now: Date,
  p: { publicationId: string; contentPieceId: string; permalink: string; publishedAt: Date },
): PublicationPublished {
  return domainEvent('publishing.publication_published', now, {
    publicationId: p.publicationId,
    contentPieceId: p.contentPieceId,
    permalink: p.permalink,
    publishedAt: p.publishedAt.toISOString(),
  });
}

export function publicationFailed(
  now: Date,
  p: { publicationId: string; contentPieceId: string; error: string; attempts: number },
): PublicationFailed {
  return domainEvent('publishing.publication_failed', now, { ...p });
}
