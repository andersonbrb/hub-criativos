import type { Clock, EventBus } from '@sbs/shared-kernel';
import type { ContentAssets, ContentPiece, ContentPieceRepository } from '../../domain';
import { loadContentPiece } from '../load-content-piece';

export interface CompleteProductionInput {
  contentPieceId: string;
  assets: ContentAssets;
}

/** Callback da plataforma de criativos quando a produção ficou `pending`. */
export class CompleteProduction {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly clock: Clock,
    private readonly events: EventBus,
  ) {}

  async execute(input: CompleteProductionInput): Promise<ContentPiece> {
    const piece = await loadContentPiece(this.pieces, input.contentPieceId);
    // A legenda localizada já foi guardada na revisão quando a produção começou.
    const { caption, hashtags } = piece.currentRevision;
    piece.completeProduction({ caption, hashtags, assets: input.assets }, this.clock.now());
    await this.pieces.save(piece);
    await this.events.publish(piece.pullEvents());
    return piece;
  }
}
