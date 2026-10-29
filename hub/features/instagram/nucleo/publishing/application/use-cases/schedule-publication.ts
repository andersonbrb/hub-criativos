import {
  ChannelId,
  ContentPieceId,
  MarketId,
  PublicationId,
  type AdaptableFormat,
  type Clock,
  type EventBus,
  type IdGenerator,
} from '@sbs/shared-kernel';
import {
  Publication,
  SLOT_OCCUPYING_STATUSES,
  SlotAllocator,
  type PublicationRepository,
} from '../../domain';
import type { ChannelDirectory } from '../ports/channel-directory';

export interface SchedulePublicationInput {
  contentPieceId: string;
  channelId: string;
  format: AdaptableFormat;
}

/**
 * Agenda uma peça aprovada no próximo horário livre da grade do canal.
 * Idempotente: se a peça já tem publicação ativa, devolve a existente sem emitir eventos
 * (o evento de aprovação pode ser entregue mais de uma vez).
 */
export class SchedulePublication {
  constructor(
    private readonly publications: PublicationRepository,
    private readonly channels: ChannelDirectory,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  async execute(input: SchedulePublicationInput): Promise<Publication> {
    const contentPieceId = ContentPieceId(input.contentPieceId);
    const existing = await this.publications.findActiveByContentPiece(contentPieceId);
    if (existing) return existing;

    const channelId = ChannelId(input.channelId);
    const target = await this.channels.getPostingTarget(channelId);
    const taken = (await this.publications.listByChannel(channelId, SLOT_OCCUPYING_STATUSES)).map(
      (p) => p.scheduledAt,
    );
    const now = this.clock.now();
    const scheduledAt = SlotAllocator.nextSlot({
      format: input.format,
      postingPlan: target.postingPlan,
      timezone: target.timezone,
      taken,
      now,
    });

    const publication = Publication.schedule(
      PublicationId(this.ids.next()),
      {
        contentPieceId,
        channelId,
        marketId: MarketId(target.marketId),
        format: input.format,
        scheduledAt,
      },
      now,
    );
    await this.publications.save(publication);
    await this.events.publish(publication.pullEvents());
    return publication;
  }
}
