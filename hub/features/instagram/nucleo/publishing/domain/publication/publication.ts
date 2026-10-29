import {
  AggregateRoot,
  ChannelId,
  ContentPieceId,
  MarketId,
  PublicationId,
  type AdaptableFormat,
} from '@sbs/shared-kernel';
import { PublishingErrors } from '../errors';
import {
  publicationFailed,
  publicationPublished,
  publicationRescheduled,
  publicationScheduled,
} from './events';
import type { PublicationStatus } from './publication-status';

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface SchedulePublicationProps {
  contentPieceId: ContentPieceId;
  channelId: ChannelId;
  marketId: MarketId;
  format: AdaptableFormat;
  scheduledAt: Date;
}

export interface PublicationSnapshot {
  id: string;
  version: number;
  contentPieceId: string;
  channelId: string;
  marketId: string;
  format: AdaptableFormat;
  scheduledAt: string;
  status: PublicationStatus;
  attempts: number;
  maxAttempts: number;
  externalMediaId: string | null;
  permalink: string | null;
  lastError: string | null;
  publishedAt: string | null;
}

/**
 * O agendamento e o envio de uma peça aprovada a um canal do Instagram.
 *
 * `scheduled → publishing → published`, com volta a `scheduled` enquanto houver
 * tentativas, e `failed` quando elas acabam.
 */
export class Publication extends AggregateRoot<PublicationId> {
  private constructor(
    id: PublicationId,
    version: number,
    readonly contentPieceId: ContentPieceId,
    readonly channelId: ChannelId,
    readonly marketId: MarketId,
    readonly format: AdaptableFormat,
    private _scheduledAt: Date,
    private _status: PublicationStatus,
    private _attempts: number,
    readonly maxAttempts: number,
    private _externalMediaId: string | null,
    private _permalink: string | null,
    private _lastError: string | null,
    private _publishedAt: Date | null,
  ) {
    super(id, version);
  }

  static schedule(id: PublicationId, props: SchedulePublicationProps, now: Date): Publication {
    const publication = new Publication(
      id,
      0,
      props.contentPieceId,
      props.channelId,
      props.marketId,
      props.format,
      requireValidDate(props.scheduledAt),
      'scheduled',
      0,
      DEFAULT_MAX_ATTEMPTS,
      null,
      null,
      null,
      null,
    );
    publication.record(
      publicationScheduled(now, {
        publicationId: id,
        contentPieceId: props.contentPieceId,
        scheduledAt: publication._scheduledAt,
      }),
    );
    return publication;
  }

  static fromSnapshot(s: PublicationSnapshot): Publication {
    return new Publication(
      PublicationId(s.id),
      s.version,
      ContentPieceId(s.contentPieceId),
      ChannelId(s.channelId),
      MarketId(s.marketId),
      s.format,
      new Date(s.scheduledAt),
      s.status,
      s.attempts,
      s.maxAttempts,
      s.externalMediaId,
      s.permalink,
      s.lastError,
      s.publishedAt ? new Date(s.publishedAt) : null,
    );
  }

  get scheduledAt(): Date {
    return new Date(this._scheduledAt);
  }
  get status() {
    return this._status;
  }
  get attempts() {
    return this._attempts;
  }
  get externalMediaId() {
    return this._externalMediaId;
  }
  get permalink() {
    return this._permalink;
  }
  get lastError() {
    return this._lastError;
  }
  get publishedAt(): Date | null {
    return this._publishedAt ? new Date(this._publishedAt) : null;
  }

  reschedule(at: Date, now: Date): void {
    this.requireStatus('reschedule', 'scheduled', 'failed');
    const scheduledAt = requireValidDate(at);
    if (scheduledAt.getTime() <= now.getTime())
      throw PublishingErrors.scheduledAtInPast(scheduledAt);

    // Reagendar uma publicação que esgotou as tentativas é dar a ela uma nova rodada.
    if (this._status === 'failed') this._attempts = 0;
    this._status = 'scheduled';
    this._scheduledAt = scheduledAt;
    this.record(
      publicationRescheduled(now, {
        publicationId: this.id,
        contentPieceId: this.contentPieceId,
        scheduledAt,
      }),
    );
  }

  startPublishing(now: Date): void {
    this.requireStatus('startPublishing', 'scheduled');
    if (this._scheduledAt.getTime() > now.getTime())
      throw PublishingErrors.publicationNotDue(this._scheduledAt);
    this._status = 'publishing';
    this._attempts += 1;
  }

  markPublished(result: { externalMediaId: string; permalink: string }, now: Date): void {
    this.requireStatus('markPublished', 'publishing');
    const externalMediaId = result.externalMediaId.trim();
    const permalink = result.permalink.trim();
    if (!externalMediaId || !permalink) throw PublishingErrors.invalidPublishResult();

    this._status = 'published';
    this._externalMediaId = externalMediaId;
    this._permalink = permalink;
    this._lastError = null;
    this._publishedAt = new Date(now);
    this.record(
      publicationPublished(now, {
        publicationId: this.id,
        contentPieceId: this.contentPieceId,
        permalink,
        publishedAt: now,
      }),
    );
  }

  markAttemptFailed(error: string, now: Date, retryAt: Date): void {
    this.requireStatus('markAttemptFailed', 'publishing');
    this._lastError = error.trim() || 'Erro desconhecido.';

    if (this._attempts < this.maxAttempts) {
      this._status = 'scheduled';
      this._scheduledAt = requireValidDate(retryAt);
      return;
    }
    this._status = 'failed';
    this.record(
      publicationFailed(now, {
        publicationId: this.id,
        contentPieceId: this.contentPieceId,
        error: this._lastError,
        attempts: this._attempts,
      }),
    );
  }

  cancel(): void {
    this.requireStatus('cancel', 'scheduled', 'failed');
    this._status = 'cancelled';
  }

  toSnapshot(): PublicationSnapshot {
    return {
      id: this.id,
      version: this.version,
      contentPieceId: this.contentPieceId,
      channelId: this.channelId,
      marketId: this.marketId,
      format: this.format,
      scheduledAt: this._scheduledAt.toISOString(),
      status: this._status,
      attempts: this._attempts,
      maxAttempts: this.maxAttempts,
      externalMediaId: this._externalMediaId,
      permalink: this._permalink,
      lastError: this._lastError,
      publishedAt: this._publishedAt ? this._publishedAt.toISOString() : null,
    };
  }

  private requireStatus(action: string, ...allowed: PublicationStatus[]): void {
    if (!allowed.includes(this._status))
      throw PublishingErrors.invalidTransition(this._status, action);
  }
}

function requireValidDate(date: Date): Date {
  if (Number.isNaN(date.getTime())) throw PublishingErrors.invalidScheduledAt();
  return new Date(date);
}
