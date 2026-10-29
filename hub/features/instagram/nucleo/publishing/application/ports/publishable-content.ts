import type { AdaptableFormat } from '@sbs/shared-kernel';

export type PublishableAssets =
  | { format: 'reel'; videoUrl: string; coverUrl: string | null }
  | { format: 'carousel'; slideUrls: string[] };

export interface PublishableContentData {
  format: AdaptableFormat;
  /** Legenda final, já com as hashtags. */
  caption: string;
  assets: PublishableAssets;
}

/** O que publicar de uma peça aprovada (contexto do Estúdio), ligado no composition root. */
export interface PublishableContent {
  get(contentPieceId: string): Promise<PublishableContentData>;
}
