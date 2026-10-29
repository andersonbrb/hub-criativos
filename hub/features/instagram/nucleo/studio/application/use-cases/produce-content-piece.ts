import { Locale, type Clock, type EventBus } from '@sbs/shared-kernel';
import type { ContentPiece, ContentPieceRepository, ProductionStep } from '../../domain';
import type { ProduceJobPayload } from '../jobs';
import { loadContentPiece } from '../load-content-piece';
import type { CopyLocalizer } from '../ports/copy-localizer';
import type { CreativeStudio } from '../ports/creative-studio';
import type { MarketDirectory } from '../ports/market-directory';
import type { ProductionContext, ProductionLine } from '../ports/production-line';
import { runProductionStage } from '../run-production-stage';

export interface ProduceContentPieceOptions {
  /** Idioma da conta de referência. */
  sourceLocale?: string;
  /** Etapas com especialista e revisor que rodam antes da legenda e dos criativos. */
  productionLine?: ProductionLine;
}

const NO_STAGES: ProductionLine = { stagesFor: async () => [] };

/** Para onde volta "Reprovar e voltar para edição": a edição do vídeo ou as imagens. */
const EDITING_STEP: Record<ContentPiece['format'], ProductionStep['kind']> = {
  reel: 'editing',
  carousel: 'images',
};

/**
 * Etapas da revisão anterior que vêm antes da edição e podem ser reaproveitadas: aprovadas
 * (com a mídia que entregaram) ou puladas. `null` se a revisão anterior não chegou à edição.
 */
function reusableSteps(piece: ContentPiece) {
  const previous = piece.revisions.at(-2);
  if (!previous) return null;
  const editing = EDITING_STEP[piece.format];
  const steps = new Map<ProductionStep['kind'], ProductionStep>();
  for (const step of previous.production) {
    if (step.kind === editing) return { revision: previous.number, steps };
    const reusable = step.status === 'skipped' || (step.status === 'approved' && step.output);
    if (!reusable) return null;
    steps.set(step.kind, step);
  }
  return null;
}

/**
 * Job `studio.produce`: roda as etapas da linha de produção (cada uma com especialista,
 * revisor e até 3 tentativas) e localiza a legenda. A mídia final é a que a linha produziu; se
 * nenhuma etapa produziu nada, pede a mídia à plataforma de criativos.
 * Qualquer erro ou etapa reprovada 3 vezes vira `failProduction`, para o social media ver e
 * tentar de novo.
 */
export class ProduceContentPiece {
  private readonly sourceLocale: string;
  private readonly line: ProductionLine;

  constructor(
    private readonly pieces: ContentPieceRepository,
    private readonly markets: MarketDirectory,
    private readonly localizer: CopyLocalizer,
    private readonly creativeStudio: CreativeStudio,
    private readonly clock: Clock,
    private readonly events: EventBus,
    options: ProduceContentPieceOptions = {},
  ) {
    this.sourceLocale = Locale(options.sourceLocale ?? 'pt-BR');
    this.line = options.productionLine ?? NO_STAGES;
  }

  async execute(input: ProduceJobPayload): Promise<ContentPiece> {
    const piece = await loadContentPiece(this.pieces, input.contentPieceId);
    const persist = async () => {
      await this.pieces.save(piece);
      await this.events.publish(piece.pullEvents());
    };

    piece.startProduction(this.clock.now());
    // Grava já em `producing`: o painel mostra o andamento e um job duplicado esbarra na versão.
    await persist();

    try {
      const market = await this.markets.getProfile(piece.marketId);
      const suggestion = piece.currentRevision.requestedChanges?.suggestion ?? null;

      let context: ProductionContext = {
        contentPieceId: piece.id,
        referencePostId: piece.referencePostId,
        format: piece.format,
        revisionNumber: piece.currentRevision.number,
        market: {
          marketId: market.marketId,
          locale: market.locale,
          productName: market.productName,
        },
        suggestion,
        source: piece.source,
        media: { mediaUrls: [...piece.source.mediaUrls], coverUrl: piece.source.thumbnailUrl },
        options: { ...piece.productionOptions },
      };
      let produced = false;
      // "Reprovar e voltar para edição": as etapas antes da edição, já aprovadas na revisão
      // anterior, são reaproveitadas (sem gastar de novo com tradução, dublagem etc.).
      const reusable = suggestion ? reusableSteps(piece) : null;
      let reusing = reusable !== null;
      for (const stage of await this.line.stagesFor(piece.format)) {
        const previous = reusing ? reusable?.steps.get(stage.specialist.kind) : undefined;
        if (previous && reusable) {
          piece.logProductionStep(
            {
              ...previous,
              note:
                previous.status === 'skipped'
                  ? previous.note
                  : `Reaproveitada da revisão ${reusable.revision}: o pedido voltou para a edição.`,
            },
            this.clock.now(),
          );
          await persist();
          if (previous.status === 'approved' && previous.output) {
            context = {
              ...context,
              media: {
                mediaUrls: [...previous.output.mediaUrls],
                coverUrl: previous.output.coverUrl,
              },
            };
            produced = true;
          }
          continue;
        }
        reusing = false;
        const outcome = await runProductionStage(piece, stage, context, this.clock, persist);
        if (!outcome.ok) {
          piece.failProduction(outcome.reason, this.clock.now());
          await persist();
          return piece;
        }
        context = outcome.context;
        produced ||= outcome.produced;
      }

      const copy = await this.localizer.localize({
        sourceCaption: piece.source.caption,
        format: piece.format,
        sourceLocale: this.sourceLocale,
        market,
        suggestion,
      });
      piece.saveLocalizedCopy(copy, this.clock.now());
      piece.logProductionStep(
        this.done(
          'caption',
          `Legenda adaptada para ${market.locale} com ${copy.hashtags.length} hashtags.`,
        ),
        this.clock.now(),
      );

      // A linha de produção gerou a mídia (armazenada, traduzida, editada): ela é a final.
      // A plataforma de criativos (ainda simulada) só entra quando a linha não produziu nada.
      if (produced) {
        piece.logProductionStep(
          {
            kind: 'creative',
            status: 'skipped',
            note: 'Mídia final vinda da linha de produção; a plataforma de criativos ainda não está integrada.',
            attempts: [],
          },
          this.clock.now(),
        );
        piece.completeProduction(
          {
            caption: copy.caption,
            hashtags: copy.hashtags,
            assets:
              piece.format === 'reel'
                ? {
                    format: 'reel',
                    videoUrl: context.media.mediaUrls[0] ?? '',
                    coverUrl: context.media.coverUrl,
                  }
                : { format: 'carousel', slideUrls: [...context.media.mediaUrls] },
          },
          this.clock.now(),
        );
        await persist();
        return piece;
      }

      const result = await this.creativeStudio.produce({
        contentPieceId: piece.id,
        format: piece.format,
        sourceMediaUrls: [...context.media.mediaUrls],
        targetLocale: market.locale,
        productName: market.productName,
        suggestion,
        keepOriginalMusic: true,
      });
      if (result.status === 'completed') {
        piece.logProductionStep(
          this.done(
            'creative',
            result.assets.format === 'reel'
              ? 'Vídeo final gerado.'
              : `${result.assets.slideUrls.length} slides gerados.`,
            result.assets.format === 'reel'
              ? [
                  result.assets.videoUrl,
                  ...(result.assets.coverUrl ? [result.assets.coverUrl] : []),
                ]
              : result.assets.slideUrls,
          ),
          this.clock.now(),
        );
        piece.completeProduction(
          { caption: copy.caption, hashtags: copy.hashtags, assets: result.assets },
          this.clock.now(),
        );
      }
    } catch (error) {
      piece.failProduction(errorMessage(error), this.clock.now());
    }

    await persist();
    return piece;
  }

  /** Etapa concluída sem revisor próprio (a governança revisa a peça inteira em seguida). */
  private done(
    kind: ProductionStep['kind'],
    summary: string,
    outputUrls: string[] = [],
  ): ProductionStep {
    const now = this.clock.now();
    return {
      kind,
      status: 'approved',
      note: null,
      attempts: [
        {
          number: 1,
          startedAt: now,
          finishedAt: now,
          summary,
          outputUrls,
          review: null,
          error: null,
        },
      ],
    };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
