import type { AdaptableFormat } from '@sbs/shared-kernel';
import type { ReviewAssets } from '../../domain';

/** O que a revisão precisa saber do mercado da peça. */
export interface ReviewMarketProfile {
  locale: string;
  productName: string;
  offerUrl: string;
  forbiddenTerms: string[];
  glossary: { source: string; target: string }[];
}

/** O que uma etapa da produção relatou (agente especialista e revisor). */
export interface ProductionNote {
  /** Nome da etapa para pessoas (ex.: "Edição"). */
  step: string;
  status: string;
  /** O que o especialista fez na última tentativa. */
  summary: string | null;
  /** Parecer do revisor da etapa. */
  reviewNotes: string | null;
  /** Por que foi pulada, se foi. */
  note: string | null;
}

/** Revisão atual de uma peça, pronta para ser revisada. */
export interface ReviewableContent {
  contentPieceId: string;
  revisionNumber: number;
  format: AdaptableFormat;
  caption: string;
  hashtags: string[];
  assets: ReviewAssets | null;
  /** Legenda original (BR), para a IA conferir a fidelidade da adaptação. */
  sourceCaption: string;
  market: ReviewMarketProfile;
  /** Registro da linha de produção desta revisão. */
  production: ProductionNote[];
  /** Relatório que vale hoje para esta revisão (o da última edição da legenda, se houve). */
  reviewReportId: string | null;
}

/**
 * Leitura da peça a revisar. O adaptador é montado no composition root sobre
 * studio (revisão atual) + markets (perfil do mercado).
 */
export interface ContentForReview {
  /** Lança `NotFoundError` se a peça não existe. */
  get(contentPieceId: string): Promise<ReviewableContent>;
}
