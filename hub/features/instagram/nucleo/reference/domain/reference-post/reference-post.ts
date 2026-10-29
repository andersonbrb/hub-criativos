import {
  AggregateRoot,
  ContentFormat,
  ReferencePostId,
  ReferenceSourceId,
  isAdaptable,
  type ProductionOptions,
} from '@sbs/shared-kernel';
import { ReferenceErrors } from '../errors';
import { referencePostSelected } from './events';
import { PostMetrics, type PostMetricsProps } from './post-metrics';

export type ReferencePostStatus = 'new' | 'selected' | 'ignored';

export interface ReferencePostProps {
  sourceId: ReferenceSourceId;
  externalId: string;
  format: ContentFormat;
  caption: string;
  permalink: string;
  thumbnailUrl: string;
  mediaUrls: string[];
  publishedAt: Date;
  metrics: PostMetricsProps;
}

export interface ReferencePostSnapshot {
  id: string;
  version: number;
  sourceId: string;
  externalId: string;
  format: ContentFormat;
  caption: string;
  permalink: string;
  thumbnailUrl: string;
  mediaUrls: string[];
  publishedAt: string;
  metrics: PostMetricsProps;
  status: ReferencePostStatus;
  selectedAt: string | null;
  adaptationsCount: number;
}

export type RefreshFromFeedProps = Pick<
  ReferencePostProps,
  'caption' | 'thumbnailUrl' | 'mediaUrls' | 'metrics'
>;

/** Um post da conta de referência, com suas métricas e o estado da seleção para adaptação. */
export class ReferencePost extends AggregateRoot<ReferencePostId> {
  private constructor(
    id: ReferencePostId,
    version: number,
    readonly sourceId: ReferenceSourceId,
    readonly externalId: string,
    readonly format: ContentFormat,
    private _caption: string,
    readonly permalink: string,
    private _thumbnailUrl: string,
    private _mediaUrls: readonly string[],
    readonly publishedAt: Date,
    private _metrics: PostMetrics,
    private _status: ReferencePostStatus,
    private _selectedAt: Date | null,
    private _adaptationsCount: number,
  ) {
    super(id, version);
  }

  static create(id: ReferencePostId, props: ReferencePostProps): ReferencePost {
    const externalId = props.externalId.trim();
    if (!externalId) throw ReferenceErrors.invalidExternalId();
    return new ReferencePost(
      id,
      0,
      props.sourceId,
      externalId,
      ContentFormat(props.format),
      props.caption,
      props.permalink,
      props.thumbnailUrl,
      [...props.mediaUrls],
      new Date(props.publishedAt),
      PostMetrics.of(props.metrics),
      'new',
      null,
      0,
    );
  }

  static fromSnapshot(s: ReferencePostSnapshot): ReferencePost {
    return new ReferencePost(
      ReferencePostId(s.id),
      s.version,
      ReferenceSourceId(s.sourceId),
      s.externalId,
      ContentFormat(s.format),
      s.caption,
      s.permalink,
      s.thumbnailUrl,
      [...s.mediaUrls],
      new Date(s.publishedAt),
      PostMetrics.of(s.metrics),
      s.status,
      s.selectedAt === null ? null : new Date(s.selectedAt),
      s.adaptationsCount,
    );
  }

  get caption(): string {
    return this._caption;
  }
  get thumbnailUrl(): string {
    return this._thumbnailUrl;
  }
  get mediaUrls(): readonly string[] {
    return this._mediaUrls;
  }
  get metrics(): PostMetrics {
    return this._metrics;
  }
  get status() {
    return this._status;
  }
  get selectedAt() {
    return this._selectedAt;
  }
  get adaptationsCount() {
    return this._adaptationsCount;
  }
  get performanceScore(): number {
    return this._metrics.performanceScore;
  }
  get isAdaptable(): boolean {
    return isAdaptable(this.format);
  }

  /** As métricas vêm do Instagram e são substituídas inteiras a cada sincronização. */
  updateMetrics(metrics: PostMetricsProps): void {
    this._metrics = PostMetrics.of(metrics);
  }

  /**
   * Atualiza com a leitura mais recente do Instagram: métricas, legenda (pode ser editada lá)
   * e mídia (as URLs do CDN do Instagram expiram). Devolve se algo mudou.
   */
  refreshFromFeed(item: RefreshFromFeedProps): boolean {
    const metrics = PostMetrics.of(item.metrics);
    const changed =
      !metrics.equals(this._metrics) ||
      item.caption !== this._caption ||
      item.thumbnailUrl !== this._thumbnailUrl ||
      item.mediaUrls.length !== this._mediaUrls.length ||
      item.mediaUrls.some((url, i) => url !== this._mediaUrls[i]);
    if (!changed) return false;
    this._metrics = metrics;
    this._caption = item.caption;
    this._thumbnailUrl = item.thumbnailUrl;
    this._mediaUrls = [...item.mediaUrls];
    return true;
  }

  /**
   * Seleciona para adaptação. Vale para post novo, ignorado (a equipe mudou de ideia) ou já
   * selecionado (nova rodada). Quem chama garante que não há adaptação em andamento — isso mora
   * no estúdio (`SelectReferencePost` consulta pela porta `AdaptationTracker`).
   */
  select(now: Date, production?: ProductionOptions): void {
    const format = this.format;
    if (!isAdaptable(format)) throw ReferenceErrors.formatNotAdaptable(format);

    this._status = 'selected';
    this._selectedAt = now;
    this.record(
      referencePostSelected(
        {
          referencePostId: this.id,
          format,
          caption: this.caption,
          permalink: this.permalink,
          thumbnailUrl: this.thumbnailUrl,
          mediaUrls: [...this._mediaUrls],
          ...(production ? { production: { ...production } } : {}),
        },
        now,
      ),
    );
  }

  /** Idempotente para posts já ignorados. */
  ignore(): void {
    if (this._status === 'selected') throw ReferenceErrors.postAlreadySelected();
    this._status = 'ignored';
  }

  registerAdaptation(): void {
    this._adaptationsCount += 1;
  }

  toSnapshot(): ReferencePostSnapshot {
    return {
      id: this.id,
      version: this.version,
      sourceId: this.sourceId,
      externalId: this.externalId,
      format: this.format,
      caption: this._caption,
      permalink: this.permalink,
      thumbnailUrl: this._thumbnailUrl,
      mediaUrls: [...this._mediaUrls],
      publishedAt: this.publishedAt.toISOString(),
      metrics: this._metrics.toProps(),
      status: this._status,
      selectedAt: this._selectedAt?.toISOString() ?? null,
      adaptationsCount: this._adaptationsCount,
    };
  }
}

/** Ordem de ranking: maior score primeiro; empate, o mais recente; depois o id (estável). */
export function compareByPerformance(a: ReferencePost, b: ReferencePost): number {
  return (
    b.performanceScore - a.performanceScore ||
    b.publishedAt.getTime() - a.publishedAt.getTime() ||
    a.id.localeCompare(b.id)
  );
}
