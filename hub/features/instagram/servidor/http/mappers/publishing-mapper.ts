import type { Publication as PublicationDto } from '@sbs/contracts';
import type { Publication } from '@sbs/publishing';

export function toPublicationDto(publication: Publication): PublicationDto {
  const s = publication.toSnapshot();
  return {
    id: s.id,
    contentPieceId: s.contentPieceId,
    channelId: s.channelId,
    marketId: s.marketId,
    format: s.format,
    scheduledAt: s.scheduledAt,
    status: s.status,
    attempts: s.attempts,
    permalink: s.permalink,
    lastError: s.lastError,
    publishedAt: s.publishedAt,
  };
}
