import type { ContentFormat } from '@sbs/shared-kernel';
import type { FeedPost, ReferenceFeed } from '../../application';
import { ReferenceErrors } from '../../domain';

/** Campos que usamos de um item do ator `apify/instagram-scraper` (resultsType: posts). */
interface ApifyPost {
  id?: string;
  type?: 'Image' | 'Video' | 'Sidecar' | string;
  shortCode?: string;
  url?: string;
  caption?: string | null;
  displayUrl?: string;
  videoUrl?: string;
  images?: string[];
  childPosts?: { displayUrl?: string; videoUrl?: string }[];
  timestamp?: string;
  likesCount?: number;
  commentsCount?: number;
  videoPlayCount?: number;
  videoViewCount?: number;
  ownerUsername?: string;
  error?: string;
  errorDescription?: string;
}

export interface ApifyReferenceFeedOptions {
  token: string;
  /** Quantos posts mais recentes do perfil ler por sincronização. */
  resultsLimit?: number;
  actorId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_ACTOR = 'apify~instagram-scraper';

/**
 * Lê os posts da conta de referência pelo perfil **público**, como um visitante (sem ser dona
 * da conta), usando o Apify — o Instagram bloqueia leitura direta de servidores. Dados públicos
 * não têm alcance, salvamentos nem compartilhamentos (ficam 0); fotos e carrosséis não mostram
 * visualizações.
 *
 * Só entram posts cujo dono é exatamente a conta cadastrada.
 */
export class ApifyReferenceFeed implements ReferenceFeed {
  private readonly token: string;
  private readonly resultsLimit: number;
  private readonly actorId: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ApifyReferenceFeedOptions) {
    this.token = options.token;
    this.resultsLimit = options.resultsLimit ?? 50;
    this.actorId = options.actorId ?? DEFAULT_ACTOR;
    this.fetchFn = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 280_000;
  }

  async fetchRecent(source: { id: string; handle: string }): Promise<FeedPost[]> {
    const handle = source.handle.toLowerCase();
    const url = `https://api.apify.com/v2/acts/${this.actorId}/run-sync-get-dataset-items`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        body: JSON.stringify({
          directUrls: [`https://www.instagram.com/${handle}/`],
          resultsType: 'posts',
          resultsLimit: this.resultsLimit,
          addParentData: false,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw ReferenceErrors.feedUnavailable(
        handle,
        error instanceof Error && error.name === 'TimeoutError'
          ? 'a leitura demorou demais. Tente de novo.'
          : 'sem conexão com o serviço de leitura (Apify).',
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw ReferenceErrors.feedUnavailable(handle, 'o token do Apify (APIFY_TOKEN) foi recusado.');
    }
    if (!response.ok) {
      throw ReferenceErrors.feedUnavailable(handle, `o Apify respondeu ${response.status}.`);
    }

    const items = (await response.json()) as ApifyPost[];
    const failure = items.find((item) => item.error);
    const posts = items
      .filter((item) => !item.error && item.ownerUsername?.toLowerCase() === handle)
      .map(toFeedPost)
      .filter((post): post is FeedPost => post !== null);

    if (posts.length === 0 && failure) {
      throw ReferenceErrors.feedUnavailable(
        handle,
        failure.errorDescription ?? failure.error ?? 'perfil não encontrado.',
      );
    }
    return posts;
  }
}

function toFeedPost(item: ApifyPost): FeedPost | null {
  const permalink =
    item.url ?? (item.shortCode ? `https://www.instagram.com/p/${item.shortCode}/` : null);
  const publishedAt = item.timestamp ? new Date(item.timestamp) : null;
  if (
    !item.id ||
    !item.displayUrl ||
    !permalink ||
    !publishedAt ||
    Number.isNaN(publishedAt.getTime())
  ) {
    return null;
  }
  const format = formatOf(item);
  return {
    externalId: item.id,
    format,
    caption: item.caption ?? '',
    permalink,
    thumbnailUrl: item.displayUrl,
    mediaUrls: mediaOf(item, format),
    publishedAt,
    metrics: {
      views: count(item.videoPlayCount ?? item.videoViewCount),
      reach: 0,
      likes: count(item.likesCount),
      comments: count(item.commentsCount),
      saves: 0,
      shares: 0,
    },
  };
}

function formatOf(item: ApifyPost): ContentFormat {
  if (item.type === 'Video') return 'reel';
  if (item.type === 'Sidecar') return 'carousel';
  return 'image';
}

function mediaOf(item: ApifyPost, format: ContentFormat): string[] {
  const cover = item.displayUrl as string;
  if (format === 'reel') return [item.videoUrl ?? cover];
  if (format === 'carousel') {
    const children = (item.childPosts ?? [])
      .map((child) => child.videoUrl ?? child.displayUrl)
      .filter((u): u is string => Boolean(u));
    if (children.length > 0) return children;
    if (item.images && item.images.length > 0) return [...item.images];
  }
  return [cover];
}

/** O Instagram devolve -1 quando o dono esconde as curtidas. */
function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Sem token configurado em produção: falha com uma mensagem clara em vez de cair em dados
 * inventados (o feed falso só existe em desenvolvimento e testes).
 */
export class UnconfiguredReferenceFeed implements ReferenceFeed {
  async fetchRecent(): Promise<FeedPost[]> {
    throw ReferenceErrors.feedNotConfigured();
  }
}
