import type { ReferencePost, ReferencePostStatus } from '@sbs/contracts';

export type ReferenceFilter = 'all' | ReferencePostStatus;

export function isAdaptable(post: Pick<ReferencePost, 'format'>): boolean {
  return post.format === 'reel' || post.format === 'carousel';
}

export type ReferenceSort = 'performance' | 'recent' | 'views' | 'comments' | 'likes';

export const REFERENCE_SORT_LABEL: Record<ReferenceSort, string> = {
  performance: 'Melhor desempenho',
  recent: 'Mais recentes',
  views: 'Mais visualizados',
  comments: 'Mais comentados',
  likes: 'Mais curtidos',
};

const SORT_KEY: Record<Exclude<ReferenceSort, 'recent'>, (post: ReferencePost) => number> = {
  performance: (post) => post.performanceScore,
  views: (post) => post.metrics.views,
  comments: (post) => post.metrics.comments,
  likes: (post) => post.metrics.likes,
};

/** Ordena pelo critério escolhido (maior primeiro); no empate, o mais recente primeiro. */
export function sortPosts(posts: readonly ReferencePost[], sort: ReferenceSort): ReferencePost[] {
  const byDate = (a: ReferencePost, b: ReferencePost) => b.publishedAt.localeCompare(a.publishedAt);
  if (sort === 'recent') return [...posts].sort(byDate);
  const key = SORT_KEY[sort];
  return [...posts].sort((a, b) => key(b) - key(a) || byDate(a, b));
}

/** Ordena por desempenho (maior primeiro) e, no empate, o mais recente primeiro. */
export function sortByPerformance(posts: readonly ReferencePost[]): ReferencePost[] {
  return sortPosts(posts, 'performance');
}

/**
 * Dados públicos do perfil não trazem alcance, salvamentos nem compartilhamentos, e só
 * reels mostram visualizações: o card esconde o que a fonte não informa (em vez de mostrar 0).
 */
export function hasPrivateInsights(post: Pick<ReferencePost, 'metrics'>): boolean {
  return post.metrics.reach > 0;
}

export type ReferenceFormatFilter = 'all' | 'reel' | 'carousel' | 'image';

export function filterByFormat(
  posts: readonly ReferencePost[],
  format: ReferenceFormatFilter,
): ReferencePost[] {
  return format === 'all' ? [...posts] : posts.filter((post) => post.format === format);
}

export function countByFormat(
  posts: readonly ReferencePost[],
): Record<ReferenceFormatFilter, number> {
  return {
    all: posts.length,
    reel: posts.filter((post) => post.format === 'reel').length,
    carousel: posts.filter((post) => post.format === 'carousel').length,
    image: posts.filter((post) => post.format === 'image').length,
  };
}

export function filterPosts(
  posts: readonly ReferencePost[],
  filter: ReferenceFilter,
): ReferencePost[] {
  return filter === 'all' ? [...posts] : posts.filter((post) => post.status === filter);
}

export function countByStatus(posts: readonly ReferencePost[]): Record<ReferenceFilter, number> {
  return {
    all: posts.length,
    new: posts.filter((post) => post.status === 'new').length,
    selected: posts.filter((post) => post.status === 'selected').length,
    ignored: posts.filter((post) => post.status === 'ignored').length,
  };
}
