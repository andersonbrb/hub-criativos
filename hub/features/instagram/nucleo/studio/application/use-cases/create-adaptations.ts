import {
  ChannelId,
  ContentPieceId,
  MarketId,
  ReferencePostId,
  type Clock,
  type EventBus,
  type IdGenerator,
  type JobQueue,
  type ReferencePostSelected,
} from '@sbs/shared-kernel';
import { ContentPiece, type ContentPieceRepository } from '../../domain';
import { StudioJobs, type ProduceJobPayload } from '../jobs';
import type { MarketDirectory } from '../ports/market-directory';

export type CreateAdaptationsInput = ReferencePostSelected['payload'];

/**
 * Uma peça por mercado ativo para o post selecionado. Nunca há duas peças em andamento do
 * mesmo post no mesmo mercado: reentregar o evento não duplica. Quando as peças anteriores
 * daquele mercado foram reprovadas ou publicadas, uma nova seleção abre uma nova rodada.
 */
export class CreateAdaptations {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly markets: MarketDirectory,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly jobs: JobQueue,
  ) {}

  async execute(input: CreateAdaptationsInput): Promise<ContentPiece[]> {
    const referencePostId = ReferencePostId(input.referencePostId);
    const created: ContentPiece[] = [];
    const busyMarkets = new Set(
      (await this.pieces.listByReference(referencePostId))
        .filter((piece) => piece.isOpen)
        .map((piece) => piece.marketId as string),
    );

    for (const target of await this.markets.listTargets()) {
      const marketId = MarketId(target.marketId);
      if (busyMarkets.has(marketId)) continue;

      const piece = ContentPiece.create(
        ContentPieceId(this.ids.next()),
        {
          referencePostId,
          marketId,
          channelId: ChannelId(target.channelId),
          format: input.format,
          source: {
            caption: input.caption,
            permalink: input.permalink,
            thumbnailUrl: input.thumbnailUrl,
            mediaUrls: input.mediaUrls,
          },
          ...(input.production ? { production: input.production } : {}),
        },
        this.clock.now(),
      );
      await this.pieces.save(piece);
      await this.events.publish(piece.pullEvents());
      await this.jobs.enqueue<ProduceJobPayload>(StudioJobs.produce, { contentPieceId: piece.id });
      created.push(piece);
      // Uma peça por mercado, mesmo que o mercado tenha mais de um canal.
      busyMarkets.add(marketId);
    }
    return created;
  }
}
