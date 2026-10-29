/**
 * Camada anticorrupção entre bounded contexts. Cada classe implementa a porta que
 * um contexto declarou, lendo de outro contexto pela API pública dele.
 * É o único lugar (junto com container.ts) onde dois contextos se encontram.
 */
import type { ContentForReview, ReviewableContent } from '@sbs/governance';
import type { MarketDirectoryQuery } from '@sbs/markets';
import type {
  ChannelDirectory,
  PostingTarget,
  PublishableContent,
  PublishableContentData,
} from '@sbs/publishing';
import type { AdaptationTracker } from '@sbs/reference';
import {
  ContentPieceId,
  NotFoundError,
  ReferencePostId,
  composePublishedCaption,
} from '@sbs/shared-kernel';
import {
  PRODUCTION_STEP_LABELS,
  type ContentPieceRepository,
  type MarketDirectory,
  type MarketProfile,
} from '@sbs/studio';

/** reference → studio: adaptações de um post que ainda estão em andamento. */
export class ReferenceAdaptationTracker implements AdaptationTracker {
  constructor(private readonly pieces: ContentPieceRepository) {}

  async countOpen(referencePostId: string): Promise<number> {
    const pieces = await this.pieces.listByReference(ReferencePostId(referencePostId));
    return pieces.filter((piece) => piece.isOpen).length;
  }

  /** Para listas: adaptações em andamento de cada post, numa leitura só. */
  async openByPost(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const piece of await this.pieces.list()) {
      if (piece.isOpen)
        counts.set(piece.referencePostId, (counts.get(piece.referencePostId) ?? 0) + 1);
    }
    return counts;
  }
}

/** studio → markets */
export class StudioMarketDirectory implements MarketDirectory {
  constructor(private readonly directory: MarketDirectoryQuery) {}

  getProfile(marketId: string): Promise<MarketProfile> {
    return this.directory.getProfile(marketId);
  }

  async listTargets(): Promise<{ marketId: string; channelId: string }[]> {
    const targets = await this.directory.listActiveTargets();
    return targets.map(({ marketId, channelId }) => ({ marketId, channelId }));
  }
}

/** governance → studio + markets */
export class GovernanceContentForReview implements ContentForReview {
  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly directory: MarketDirectoryQuery,
  ) {}

  async get(contentPieceId: string): Promise<ReviewableContent> {
    const piece = await this.pieces.findById(ContentPieceId(contentPieceId));
    if (!piece) throw new NotFoundError('Peça de conteúdo', contentPieceId);
    const revision = piece.currentRevision;
    const market = await this.directory.getProfile(piece.marketId);
    return {
      contentPieceId,
      revisionNumber: revision.number,
      format: piece.format,
      caption: revision.caption,
      hashtags: [...revision.hashtags],
      assets: revision.assets,
      sourceCaption: piece.source.caption,
      production: revision.production.map((step) => {
        const last = step.attempts.at(-1);
        return {
          step: PRODUCTION_STEP_LABELS[step.kind],
          status: step.status,
          summary: last?.summary ?? null,
          reviewNotes: last?.review?.notes ?? last?.error ?? null,
          note: step.note,
        };
      }),
      market: {
        locale: market.locale,
        productName: market.productName,
        offerUrl: market.offerUrl,
        forbiddenTerms: market.forbiddenTerms,
        glossary: market.glossary,
      },
      reviewReportId: revision.automatedReview?.reportId ?? null,
    };
  }
}

/** publishing → markets */
export class PublishingChannelDirectory implements ChannelDirectory {
  constructor(private readonly directory: MarketDirectoryQuery) {}

  async getPostingTarget(channelId: string): Promise<PostingTarget> {
    const t = await this.directory.getTargetByChannel(channelId);
    return {
      channelId: t.channelId,
      marketId: t.marketId,
      timezone: t.timezone,
      postingPlan: t.postingPlan,
      externalAccountId: t.externalAccountId,
    };
  }
}

/** publishing → studio */
export class PublishingContentSource implements PublishableContent {
  constructor(private readonly pieces: ContentPieceRepository) {}

  async get(contentPieceId: string): Promise<PublishableContentData> {
    const piece = await this.pieces.findById(ContentPieceId(contentPieceId));
    if (!piece) throw new NotFoundError('Peça de conteúdo', contentPieceId);
    const revision = piece.currentRevision;
    if (!revision.assets) throw new NotFoundError('Mídia da peça', contentPieceId);
    return {
      format: piece.format,
      caption: composePublishedCaption(revision.caption, revision.hashtags),
      assets: revision.assets,
    };
  }
}
