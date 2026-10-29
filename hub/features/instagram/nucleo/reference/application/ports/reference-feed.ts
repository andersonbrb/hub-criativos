import type { ContentFormat } from '@sbs/shared-kernel';
import type { PostMetricsProps } from '../../domain';

/** Um post como a fonte externa (Instagram) o entrega. */
export interface FeedPost {
  externalId: string;
  format: ContentFormat;
  caption: string;
  permalink: string;
  thumbnailUrl: string;
  mediaUrls: string[];
  publishedAt: Date;
  metrics: PostMetricsProps;
}

/** Leitura dos posts recentes da conta de referência (adaptador real: Instagram API). */
export interface ReferenceFeed {
  fetchRecent(source: { id: string; handle: string }, now: Date): Promise<FeedPost[]>;
}
