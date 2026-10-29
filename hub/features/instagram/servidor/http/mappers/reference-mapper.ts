import type {
  ReferencePost as ReferencePostDto,
  ReferenceSource as ReferenceSourceDto,
} from '@sbs/contracts';
import type { ReferencePost, ReferenceSource } from '@sbs/reference';

export function toReferenceSourceDto(
  source: ReferenceSource,
  postsCount: number,
): ReferenceSourceDto {
  const s = source.toSnapshot();
  return {
    id: s.id,
    handle: s.handle,
    locale: s.locale,
    connectionStatus: s.connectionStatus,
    lastSyncedAt: s.lastSyncedAt,
    postsCount,
  };
}

export function toReferencePostDto(
  post: ReferencePost,
  openAdaptationsCount = 0,
): ReferencePostDto {
  const s = post.toSnapshot();
  return {
    id: s.id,
    sourceId: s.sourceId,
    externalId: s.externalId,
    format: s.format,
    caption: s.caption,
    permalink: s.permalink,
    thumbnailUrl: s.thumbnailUrl,
    mediaUrls: s.mediaUrls,
    publishedAt: s.publishedAt,
    metrics: s.metrics,
    performanceScore: post.performanceScore,
    status: s.status,
    selectedAt: s.selectedAt,
    adaptationsCount: s.adaptationsCount,
    openAdaptationsCount,
  };
}
