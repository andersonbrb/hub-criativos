import type { AdaptableFormat } from '@sbs/shared-kernel';
import type { ContentAssets } from '../../domain';

export interface ProduceCreativeInput {
  contentPieceId: string;
  format: AdaptableFormat;
  sourceMediaUrls: string[];
  targetLocale: string;
  productName: string;
  suggestion: string | null;
  keepOriginalMusic: true;
}

/** `pending`: a plataforma avisa depois, pelo callback que chama `CompleteProduction`. */
export type CreativeResult =
  { status: 'completed'; assets: ContentAssets } | { status: 'pending'; jobId: string };

/** Plataforma interna de criativos (vídeo, voz, tradução, re-render de slides). */
export interface CreativeStudio {
  produce(input: ProduceCreativeInput): Promise<CreativeResult>;
}
