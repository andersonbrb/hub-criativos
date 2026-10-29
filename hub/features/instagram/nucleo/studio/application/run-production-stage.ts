import type { Clock } from '@sbs/shared-kernel';
import {
  MAX_STEP_ATTEMPTS,
  type ContentPiece,
  type ProductionStep,
  type StepAttempt,
} from '../domain';
import type { ProductionContext, ProductionStage } from './ports/production-line';

/** `produced`: a etapa rodou e foi aprovada (não foi pulada). */
export type StageOutcome =
  { ok: true; context: ProductionContext; produced: boolean } | { ok: false; reason: string };

/** Nome de cada etapa para pessoas. */
export const PRODUCTION_STEP_LABELS: Record<ProductionStep['kind'], string> = {
  ingest: 'Armazenamento da mídia',
  subtitle_removal: 'Remoção de legendas',
  video_translation: 'Tradução do vídeo',
  audio: 'Áudio',
  images: 'Imagens',
  editing: 'Edição',
  caption: 'Legenda',
  creative: 'Criativos',
};

/**
 * Roda uma etapa: o especialista faz, o revisor aprova ou devolve com o motivo, até
 * {@link MAX_STEP_ATTEMPTS} vezes. Cada tentativa é registrada na peça e gravada na hora
 * (`persist`), para o painel acompanhar.
 */
export async function runProductionStage(
  piece: ContentPiece,
  stage: ProductionStage,
  context: ProductionContext,
  clock: Clock,
  persist: () => Promise<void>,
): Promise<StageOutcome> {
  const { specialist, reviewer } = stage;
  const kind = specialist.kind;
  const log = async (step: Omit<ProductionStep, 'kind'>) => {
    piece.logProductionStep({ kind, ...step }, clock.now());
    await persist();
  };

  const skip = await specialist.skipReason(context);
  if (skip) {
    await log({ status: 'skipped', note: skip, attempts: [] });
    return { ok: true, context, produced: false };
  }

  const attempts: StepAttempt[] = [];
  let feedback: string | null = null;
  for (let number = 1; number <= MAX_STEP_ATTEMPTS; number += 1) {
    const startedAt = clock.now();
    await log({ status: 'running', note: null, attempts });

    let result;
    try {
      result = await specialist.run(context, feedback);
    } catch (error) {
      attempts.push({
        number,
        startedAt,
        finishedAt: clock.now(),
        summary: null,
        outputUrls: [],
        review: null,
        error: errorMessage(error),
      });
      await log({ status: 'failed', note: null, attempts });
      return {
        ok: false,
        reason: `${PRODUCTION_STEP_LABELS[kind]}: ${errorMessage(error)}`,
      };
    }

    const review = reviewer
      ? await reviewer.review(context, result).catch((error: unknown) => ({
          approved: false,
          notes: `O revisor não conseguiu avaliar: ${errorMessage(error)}`,
        }))
      : { approved: true, notes: 'Sem revisor nesta etapa.' };
    attempts.push({
      number,
      startedAt,
      finishedAt: clock.now(),
      summary: result.summary,
      outputUrls: [
        ...result.media.mediaUrls,
        ...(result.media.coverUrl ? [result.media.coverUrl] : []),
      ],
      review,
      error: null,
    });

    if (review.approved) {
      await log({ status: 'approved', note: null, attempts, output: result.media });
      return { ok: true, context: { ...context, media: result.media }, produced: true };
    }
    feedback = review.notes;
  }

  await log({ status: 'rejected', note: null, attempts });
  return {
    ok: false,
    reason: `${PRODUCTION_STEP_LABELS[kind]} reprovada ${MAX_STEP_ATTEMPTS} vezes pelo revisor. Último parecer: ${feedback ?? '—'}`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
