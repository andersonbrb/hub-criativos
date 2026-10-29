import { StudioErrors } from '../errors';

/**
 * Etapas da produção de uma revisão. Cada uma tem um agente especialista (que faz) e, quando
 * há, um revisor (que aprova ou devolve com o motivo), com até {@link MAX_STEP_ATTEMPTS}
 * tentativas.
 */
export const PRODUCTION_STEP_KINDS = [
  'ingest',
  'subtitle_removal',
  'video_translation',
  'audio',
  'images',
  'editing',
  'caption',
  'creative',
] as const;
export type ProductionStepKind = (typeof PRODUCTION_STEP_KINDS)[number];

export const PRODUCTION_STEP_STATUSES = [
  'running',
  'approved',
  'rejected',
  'skipped',
  'failed',
] as const;
export type ProductionStepStatus = (typeof PRODUCTION_STEP_STATUSES)[number];

/** Reprovada esta quantidade de vezes, a etapa para e a peça espera decisão humana. */
export const MAX_STEP_ATTEMPTS = 3;

export interface StepReview {
  readonly approved: boolean;
  /** Parecer do revisor: o motivo da reprovação ou o que foi conferido. */
  readonly notes: string;
}

export interface StepAttempt {
  readonly number: number;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  /** O que o especialista fez, em uma frase. */
  readonly summary: string | null;
  /** Arquivos produzidos nesta tentativa (links). */
  readonly outputUrls: readonly string[];
  readonly review: StepReview | null;
  readonly error: string | null;
}

/** A mídia que uma etapa aprovada entregou para a próxima (reaproveitada ao voltar para a edição). */
export interface StepOutput {
  readonly mediaUrls: readonly string[];
  readonly coverUrl: string | null;
}

export interface ProductionStep {
  readonly kind: ProductionStepKind;
  readonly status: ProductionStepStatus;
  /** Quando a etapa foi pulada: por quê (ex.: integração não conectada). */
  readonly note: string | null;
  readonly attempts: readonly StepAttempt[];
  /** Só em etapa aprovada: a mídia entregue à próxima etapa. */
  readonly output?: StepOutput | null;
}

export interface StepAttemptSnapshot {
  number: number;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  outputUrls: string[];
  review: StepReview | null;
  error: string | null;
}

export interface ProductionStepSnapshot {
  kind: ProductionStepKind;
  status: ProductionStepStatus;
  note: string | null;
  attempts: StepAttemptSnapshot[];
  /** Ausente em registros antigos. */
  output?: { mediaUrls: string[]; coverUrl: string | null } | null;
}

/** Valida e copia um registro de etapa vindo da aplicação. */
export function validateProductionStep(step: ProductionStep): ProductionStep {
  if (!(PRODUCTION_STEP_KINDS as readonly string[]).includes(step.kind))
    throw StudioErrors.invalidProductionStep(`etapa "${String(step.kind)}" desconhecida.`);
  if (!(PRODUCTION_STEP_STATUSES as readonly string[]).includes(step.status))
    throw StudioErrors.invalidProductionStep(`situação "${String(step.status)}" desconhecida.`);
  if (step.attempts.length > MAX_STEP_ATTEMPTS)
    throw StudioErrors.invalidProductionStep(
      `no máximo ${MAX_STEP_ATTEMPTS} tentativas por etapa.`,
    );
  return productionStepFromSnapshot(productionStepToSnapshot(step));
}

export function productionStepToSnapshot(step: ProductionStep): ProductionStepSnapshot {
  return {
    kind: step.kind,
    status: step.status,
    note: step.note,
    attempts: step.attempts.map((a) => ({
      number: a.number,
      startedAt: a.startedAt.toISOString(),
      finishedAt: a.finishedAt?.toISOString() ?? null,
      summary: a.summary,
      outputUrls: [...a.outputUrls],
      review: a.review ? { ...a.review } : null,
      error: a.error,
    })),
    output: step.output
      ? { mediaUrls: [...step.output.mediaUrls], coverUrl: step.output.coverUrl }
      : null,
  };
}

export function productionStepFromSnapshot(s: ProductionStepSnapshot): ProductionStep {
  return {
    kind: s.kind,
    status: s.status,
    note: s.note,
    attempts: s.attempts.map((a) => ({
      number: a.number,
      startedAt: new Date(a.startedAt),
      finishedAt: a.finishedAt === null ? null : new Date(a.finishedAt),
      summary: a.summary,
      outputUrls: [...a.outputUrls],
      review: a.review ? { ...a.review } : null,
      error: a.error,
    })),
    output: s.output ? { mediaUrls: [...s.output.mediaUrls], coverUrl: s.output.coverUrl } : null,
  };
}
