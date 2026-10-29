import {
  AggregateRoot,
  ChannelId,
  ContentPieceId,
  MarketId,
  PublicationId,
  ReferencePostId,
  normalizeProductionOptions,
  type AdaptableFormat,
  type ProductionOptions,
  type UserId,
} from '@sbs/shared-kernel';
import { StudioErrors } from '../errors';
import { validateAssets, type ContentAssets } from './content-assets';
import {
  isOpenContentPieceStatus,
  type ContentPieceAction,
  type ContentPieceStatus,
} from './content-piece-status';
import { StudioEvents } from './events';
import { validateProductionStep, type ProductionStep } from './production-step';
import {
  changeRequestFromSnapshot,
  changeRequestToSnapshot,
  firstRevision,
  normalizeHashtags,
  revisionFromSnapshot,
  revisionToSnapshot,
  type AutomatedReview,
  type ChangeRequest,
  type ChangeRequestSnapshot,
  type Revision,
  type RevisionSnapshot,
} from './revision';
import {
  statusChangeFromSnapshot,
  statusChangeToSnapshot,
  type StatusChange,
  type StatusChangeSnapshot,
} from './status-change';

/** Cópia do post de referência, para o revisor comparar lado a lado. */
export interface ContentSource {
  caption: string;
  permalink: string;
  thumbnailUrl: string;
  mediaUrls: string[];
}

export interface PublicationInfo {
  readonly id: PublicationId;
  readonly scheduledAt: Date;
  readonly status: 'scheduled' | 'published';
  readonly permalink: string | null;
  readonly publishedAt: Date | null;
}

export interface PublicationInfoSnapshot {
  id: string;
  scheduledAt: string;
  status: 'scheduled' | 'published';
  permalink: string | null;
  publishedAt: string | null;
}

export interface NewContentPiece {
  referencePostId: ReferencePostId;
  marketId: MarketId;
  channelId: ChannelId;
  format: AdaptableFormat;
  source: ContentSource;
  /** Escolhas de produção feitas na seleção do post (padrões se ausente). */
  production?: Partial<ProductionOptions>;
}

export interface ProducedContent {
  caption: string;
  hashtags: readonly string[];
  assets: ContentAssets;
}

export interface LocalizedCopyDraft {
  caption: string;
  hashtags: readonly string[];
}

export interface ContentPieceSnapshot {
  id: string;
  version: number;
  referencePostId: string;
  marketId: string;
  channelId: string;
  format: AdaptableFormat;
  source: ContentSource;
  status: ContentPieceStatus;
  /** A última é a revisão atual. */
  revisions: RevisionSnapshot[];
  history: StatusChangeSnapshot[];
  failureReason: string | null;
  publication: PublicationInfoSnapshot | null;
  /** Pedido de ajustes aguardando a próxima produção (só em `changes_requested`). */
  pendingChangeRequest: ChangeRequestSnapshot | null;
  /** Ausente em peças criadas antes das opções de produção. */
  productionOptions?: ProductionOptions;
  createdAt: string;
  updatedAt: string;
}

const MIN_DECISION_TEXT = 3;

/**
 * A adaptação de um post de referência para um mercado, da produção até a decisão do
 * revisor e a publicação. Pedir ajustes gera uma nova revisão; a última é a atual.
 */
export class ContentPiece extends AggregateRoot<ContentPieceId> {
  private constructor(
    id: ContentPieceId,
    version: number,
    readonly referencePostId: ReferencePostId,
    readonly marketId: MarketId,
    readonly channelId: ChannelId,
    readonly format: AdaptableFormat,
    readonly source: Readonly<ContentSource>,
    readonly createdAt: Date,
    private _status: ContentPieceStatus,
    private _pastRevisions: Revision[],
    private _currentRevision: Revision,
    private _history: StatusChange[],
    private _failureReason: string | null,
    private _publication: PublicationInfo | null,
    private _pendingChangeRequest: ChangeRequest | null,
    private _updatedAt: Date,
    readonly productionOptions: Readonly<ProductionOptions>,
  ) {
    super(id, version);
  }

  static create(id: ContentPieceId, props: NewContentPiece, now: Date): ContentPiece {
    const piece = new ContentPiece(
      id,
      0,
      props.referencePostId,
      props.marketId,
      props.channelId,
      props.format,
      copySource(props.source),
      now,
      'queued',
      [],
      firstRevision(now),
      [{ from: null, to: 'queued', at: now, by: null, note: null }],
      null,
      null,
      null,
      now,
      normalizeProductionOptions(props.production),
    );
    piece.record(
      StudioEvents.created(now, {
        contentPieceId: id,
        referencePostId: props.referencePostId,
        marketId: props.marketId,
      }),
    );
    return piece;
  }

  static fromSnapshot(s: ContentPieceSnapshot): ContentPiece {
    const revisions = s.revisions.map(revisionFromSnapshot);
    const current = revisions.pop();
    if (!current) throw StudioErrors.corruptedSnapshot(s.id);
    return new ContentPiece(
      ContentPieceId(s.id),
      s.version,
      ReferencePostId(s.referencePostId),
      MarketId(s.marketId),
      ChannelId(s.channelId),
      s.format,
      copySource(s.source),
      new Date(s.createdAt),
      s.status,
      revisions,
      current,
      s.history.map(statusChangeFromSnapshot),
      s.failureReason,
      s.publication
        ? {
            id: PublicationId(s.publication.id),
            scheduledAt: new Date(s.publication.scheduledAt),
            status: s.publication.status,
            permalink: s.publication.permalink,
            publishedAt: s.publication.publishedAt ? new Date(s.publication.publishedAt) : null,
          }
        : null,
      s.pendingChangeRequest ? changeRequestFromSnapshot(s.pendingChangeRequest) : null,
      new Date(s.updatedAt),
      normalizeProductionOptions(s.productionOptions),
    );
  }

  get status(): ContentPieceStatus {
    return this._status;
  }
  /** Em andamento: ainda não foi reprovada nem publicada. */
  get isOpen(): boolean {
    return isOpenContentPieceStatus(this._status);
  }
  get currentRevision(): Revision {
    return this._currentRevision;
  }
  get revisions(): readonly Revision[] {
    return [...this._pastRevisions, this._currentRevision];
  }
  get history(): readonly StatusChange[] {
    return this._history;
  }
  get failureReason(): string | null {
    return this._failureReason;
  }
  get publication(): PublicationInfo | null {
    return this._publication;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  isCurrentRevision(revisionNumber: number): boolean {
    return this._currentRevision.number === revisionNumber;
  }

  // ── produção ─────────────────────────────────────────────────────────────

  /**
   * Vindo de `changes_requested`, abre uma nova revisão com a sugestão do revisor;
   * vindo de `queued`/`failed`, refaz a revisão atual.
   */
  startProduction(now: Date): void {
    this.ensureStatus('startProduction', ['queued', 'changes_requested', 'failed']);
    let note: string | null = null;
    if (this._status === 'changes_requested') {
      const previous = this._currentRevision;
      this._pastRevisions.push(previous);
      this._currentRevision = {
        number: previous.number + 1,
        createdAt: now,
        // Mantém o texto anterior até a nova produção substituí-lo.
        caption: previous.caption,
        hashtags: [...previous.hashtags],
        assets: null,
        requestedChanges: this._pendingChangeRequest,
        automatedReview: null,
        production: [],
      };
      this._pendingChangeRequest = null;
      note = `Revisão ${this._currentRevision.number} criada a partir do pedido de ajustes.`;
    }
    this._failureReason = null;
    // Cada produção começa um registro novo (a tentativa anterior fica no histórico de status).
    this._currentRevision = { ...this._currentRevision, production: [] };
    this.transition('producing', now, null, note);
  }

  /**
   * Registra (ou atualiza) uma etapa da produção: o que o especialista fez, o parecer do
   * revisor e cada tentativa. Uma etapa por tipo em cada revisão.
   */
  logProductionStep(step: ProductionStep, now: Date): void {
    this.ensureStatus('logProductionStep', ['producing']);
    const validated = validateProductionStep(step);
    const others = this._currentRevision.production.filter((s) => s.kind !== validated.kind);
    const index = this._currentRevision.production.findIndex((s) => s.kind === validated.kind);
    const production =
      index === -1
        ? [...others, validated]
        : this._currentRevision.production.map((s, i) => (i === index ? validated : s));
    this._currentRevision = { ...this._currentRevision, production };
    this._updatedAt = now;
  }

  /**
   * Guarda a legenda localizada enquanto a mídia ainda está sendo feita, para que a
   * conclusão assíncrona (callback da plataforma de criativos) não precise refazê-la.
   */
  saveLocalizedCopy(copy: LocalizedCopyDraft, now: Date): void {
    this.ensureStatus('saveLocalizedCopy', ['producing']);
    this._currentRevision = {
      ...this._currentRevision,
      caption: requireCaption(copy.caption),
      hashtags: normalizeHashtags(copy.hashtags),
    };
    this._updatedAt = now;
  }

  completeProduction(content: ProducedContent, now: Date): void {
    this.ensureStatus('completeProduction', ['producing']);
    const caption = requireCaption(content.caption);
    const assets = validateAssets(this.format, content.assets);
    this._currentRevision = {
      ...this._currentRevision,
      caption,
      hashtags: normalizeHashtags(content.hashtags),
      assets,
      automatedReview: null,
    };
    this.transition('ai_review', now);
    this.record(
      StudioEvents.produced(now, {
        contentPieceId: this.id,
        marketId: this.marketId,
        revisionNumber: this._currentRevision.number,
      }),
    );
  }

  failProduction(reason: string, now: Date): void {
    this.ensureStatus('failProduction', ['producing']);
    const cleaned = reason.trim() || 'Falha desconhecida na produção.';
    this._failureReason = cleaned;
    this.transition('failed', now, null, cleaned);
    this.record(StudioEvents.failed(now, { contentPieceId: this.id, reason: cleaned }));
  }

  /** A nova tentativa em si é um `startProduction`; aqui só se confirma que cabe uma. */
  ensureRetryable(): void {
    if (this._status !== 'failed')
      throw StudioErrors.invalidTransition(this._status, 'retryProduction');
  }

  // ── revisão ──────────────────────────────────────────────────────────────

  recordAutomatedReview(review: AutomatedReview, now: Date): void {
    this.ensureStatus('recordAutomatedReview', ['ai_review']);
    this._currentRevision = {
      ...this._currentRevision,
      automatedReview: requireAutomatedReview(review),
    };
    const note = review.hasBlockingIssues
      ? `Revisão automática: nota ${review.score}, com problemas bloqueantes.`
      : `Revisão automática: nota ${review.score}.`;
    this.transition('awaiting_approval', now, null, note);
  }

  /** A legenda e as hashtags da revisão atual já são estas (depois de normalizadas)? */
  hasCaption(caption: string, hashtags: readonly string[]): boolean {
    const current = this._currentRevision;
    const tags = normalizeHashtags(hashtags);
    return (
      current.caption === caption.trim() &&
      current.hashtags.length === tags.length &&
      current.hashtags.every((tag, i) => tag === tags[i])
    );
  }

  /**
   * Ajuste fino do revisor sem nova produção: não muda o status, mas fica no histórico.
   * `review` é a revisão automática refeita sobre o texto editado; passa a valer no lugar da
   * anterior (inclusive para bloquear a aprovação).
   */
  editCaption(
    caption: string,
    hashtags: readonly string[],
    by: UserId,
    now: Date,
    review: AutomatedReview | null = null,
  ): void {
    this.ensureStatus('editCaption', ['awaiting_approval']);
    this._currentRevision = {
      ...this._currentRevision,
      caption: requireCaption(caption),
      hashtags: normalizeHashtags(hashtags),
      ...(review ? { automatedReview: requireAutomatedReview(review) } : {}),
    };
    const note = review
      ? `Legenda editada pelo revisor. ${describeReview(review)}`
      : 'Legenda editada pelo revisor.';
    this.transition('awaiting_approval', now, by, note);
  }

  approve(by: UserId, now: Date): void {
    this.ensureStatus('approve', ['awaiting_approval']);
    if (!this._currentRevision.assets) throw StudioErrors.assetsMissing();
    if (this._currentRevision.automatedReview?.hasBlockingIssues)
      throw StudioErrors.blockingIssuesUnresolved();
    this.transition('approved', now, by);
    this.record(
      StudioEvents.approved(now, {
        contentPieceId: this.id,
        marketId: this.marketId,
        channelId: this.channelId,
        format: this.format,
        approvedBy: by,
      }),
    );
  }

  reject(by: UserId, reason: string, now: Date): void {
    this.ensureStatus('reject', ['awaiting_approval']);
    const cleaned = requireDecisionText(reason, StudioErrors.invalidRejectionReason);
    this.transition('rejected', now, by, cleaned);
    this.record(
      StudioEvents.rejected(now, { contentPieceId: this.id, rejectedBy: by, reason: cleaned }),
    );
  }

  requestChanges(by: UserId, suggestion: string, now: Date): void {
    this.ensureStatus('requestChanges', ['awaiting_approval']);
    const cleaned = requireDecisionText(suggestion, StudioErrors.invalidChangeSuggestion);
    this._pendingChangeRequest = { by, suggestion: cleaned, at: now };
    this.transition('changes_requested', now, by, cleaned);
    this.record(
      StudioEvents.changesRequested(now, {
        contentPieceId: this.id,
        requestedBy: by,
        suggestion: cleaned,
      }),
    );
  }

  // ── publicação ───────────────────────────────────────────────────────────

  /** Primeiro agendamento (de `approved`) ou reagendamento (de `scheduled`). */
  markScheduled(input: { publicationId: PublicationId; scheduledAt: Date }, now: Date): void {
    this.ensureStatus('markScheduled', ['approved', 'scheduled']);
    const verb = this._status === 'scheduled' ? 'Reagendada' : 'Agendada';
    this._publication = {
      id: input.publicationId,
      scheduledAt: input.scheduledAt,
      status: 'scheduled',
      permalink: null,
      publishedAt: null,
    };
    this.transition('scheduled', now, null, `${verb} para ${input.scheduledAt.toISOString()}.`);
  }

  markPublished(input: { permalink: string; publishedAt: Date }, now: Date): void {
    this.ensureStatus('markPublished', ['scheduled']);
    const publication = this._publication;
    if (!publication) throw StudioErrors.invalidTransition(this._status, 'markPublished');
    this._publication = {
      ...publication,
      status: 'published',
      permalink: input.permalink,
      publishedAt: input.publishedAt,
    };
    this.transition('published', now);
  }

  toSnapshot(): ContentPieceSnapshot {
    const publication = this._publication;
    return {
      id: this.id,
      version: this.version,
      referencePostId: this.referencePostId,
      marketId: this.marketId,
      channelId: this.channelId,
      format: this.format,
      source: copySource(this.source),
      status: this._status,
      revisions: this.revisions.map(revisionToSnapshot),
      history: this._history.map(statusChangeToSnapshot),
      failureReason: this._failureReason,
      publication: publication
        ? {
            id: publication.id,
            scheduledAt: publication.scheduledAt.toISOString(),
            status: publication.status,
            permalink: publication.permalink,
            publishedAt: publication.publishedAt ? publication.publishedAt.toISOString() : null,
          }
        : null,
      pendingChangeRequest: this._pendingChangeRequest
        ? changeRequestToSnapshot(this._pendingChangeRequest)
        : null,
      productionOptions: { ...this.productionOptions },
      createdAt: this.createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }

  private ensureStatus(action: ContentPieceAction, allowed: readonly ContentPieceStatus[]): void {
    if (!allowed.includes(this._status)) throw StudioErrors.invalidTransition(this._status, action);
  }

  private transition(
    to: ContentPieceStatus,
    now: Date,
    by: string | null = null,
    note: string | null = null,
  ): void {
    this._history.push({ from: this._status, to, at: now, by, note });
    this._status = to;
    this._updatedAt = now;
  }
}

function copySource(source: Readonly<ContentSource>): ContentSource {
  return { ...source, mediaUrls: [...source.mediaUrls] };
}

function requireAutomatedReview(review: AutomatedReview): AutomatedReview {
  if (!Number.isFinite(review.score) || review.score < 0 || review.score > 100)
    throw StudioErrors.invalidReviewScore(review.score);
  return {
    reportId: review.reportId,
    score: review.score,
    hasBlockingIssues: review.hasBlockingIssues,
  };
}

function describeReview(review: AutomatedReview): string {
  return review.hasBlockingIssues
    ? `Revisão automática refeita: nota ${review.score}, com problemas bloqueantes.`
    : `Revisão automática refeita: nota ${review.score}.`;
}

function requireCaption(caption: string): string {
  const trimmed = caption.trim();
  if (!trimmed) throw StudioErrors.invalidCaption();
  return trimmed;
}

function requireDecisionText(text: string, error: () => Error): string {
  const trimmed = text.trim();
  if (trimmed.length < MIN_DECISION_TEXT) throw error();
  return trimmed;
}
