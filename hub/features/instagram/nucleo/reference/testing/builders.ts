import { ReferencePostId, ReferenceSourceId } from '@sbs/shared-kernel';
import type { FeedPost } from '../application';
import { ReferencePost, type PostMetricsProps, type ReferencePostProps } from '../domain';

export function aPostMetrics(overrides: Partial<PostMetricsProps> = {}): PostMetricsProps {
  return {
    views: 10_000,
    reach: 8_000,
    likes: 500,
    comments: 40,
    saves: 60,
    shares: 30,
    ...overrides,
  };
}

export function aReferencePostProps(
  overrides: Partial<ReferencePostProps> = {},
): ReferencePostProps {
  return {
    sourceId: ReferenceSourceId('src-1'),
    externalId: '18047213958200001',
    format: 'reel',
    caption: 'Oração de São Bento para proteção do lar 🙏 #saobento',
    permalink: 'https://www.instagram.com/p/DBx7kQ2sR1a/',
    thumbnailUrl: 'https://picsum.photos/seed/sbs-test/1080/1350',
    mediaUrls: ['https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4'],
    publishedAt: new Date('2026-10-10T12:00:00.000Z'),
    metrics: aPostMetrics(),
    ...overrides,
  };
}

/** Post já criado (status `new`), com id `post-1` por padrão. */
export function aReferencePost(
  overrides: Partial<ReferencePostProps> & { id?: string } = {},
): ReferencePost {
  const { id = 'post-1', ...props } = overrides;
  return ReferencePost.create(ReferencePostId(id), aReferencePostProps(props));
}

export function aFeedPost(overrides: Partial<FeedPost> = {}): FeedPost {
  const { sourceId: _sourceId, ...props } = aReferencePostProps();
  return { ...props, ...overrides };
}
