import type { AdaptableFormat, ProductionOptions } from '@sbs/shared-kernel';
import type { ContentSource, ProductionStepKind, StepReview } from '../../domain';

/** A mídia de trabalho que passa de uma etapa para a outra. */
export interface ProductionMedia {
  /** Vídeo (reel) ou slides (carrossel), na ordem. */
  mediaUrls: string[];
  coverUrl: string | null;
}

export interface ProductionContext {
  contentPieceId: string;
  referencePostId: string;
  format: AdaptableFormat;
  revisionNumber: number;
  market: { marketId: string; locale: string; productName: string };
  /** Pedido de ajustes do social media, se a produção veio de um. */
  suggestion: string | null;
  source: ContentSource;
  media: ProductionMedia;
  /** Escolhas feitas na seleção do post (ferramenta de tradução, modo do HeyGen). */
  options: ProductionOptions;
}

export interface SpecialistResult {
  media: ProductionMedia;
  /** O que foi feito, em uma frase, para o registro da etapa. */
  summary: string;
}

/** Agente que executa uma etapa (ex.: copiar a mídia, traduzir o vídeo, editar). */
export interface ProductionSpecialist {
  readonly kind: ProductionStepKind;
  /** Motivo para pular a etapa (ex.: integração não conectada) ou `null` para executar. */
  skipReason(context: ProductionContext): Promise<string | null>;
  /** `feedback`: o motivo da reprovação anterior do revisor, para corrigir. */
  run(context: ProductionContext, feedback: string | null): Promise<SpecialistResult>;
}

/** Agente que avalia o resultado do especialista: aprova ou devolve com o motivo. */
export interface ProductionReviewer {
  review(context: ProductionContext, result: SpecialistResult): Promise<StepReview>;
}

export interface ProductionStage {
  specialist: ProductionSpecialist;
  /** Sem revisor, o resultado do especialista segue direto. */
  reviewer: ProductionReviewer | null;
}

/**
 * As etapas, em ordem, para um formato. Montada no composition root conforme as integrações
 * conectadas (as ainda não conectadas são puladas com o motivo).
 */
export interface ProductionLine {
  stagesFor(format: AdaptableFormat): Promise<ProductionStage[]>;
}
