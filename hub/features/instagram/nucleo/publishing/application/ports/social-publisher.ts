import type { AdaptableFormat } from '@sbs/shared-kernel';
import type { PublishableAssets } from './publishable-content';

export interface PublishRequest {
  /** Canal da publicação (cada canal tem a sua conta e o seu acesso). */
  channelId: string;
  channelExternalAccountId: string | null;
  format: AdaptableFormat;
  assets: PublishableAssets;
  caption: string;
}

export interface PublishResult {
  externalMediaId: string;
  permalink: string;
}

/** Envia a mídia à rede social. Lança erro em qualquer falha (a aplicação decide o retry). */
export interface SocialPublisher {
  publish(request: PublishRequest): Promise<PublishResult>;
}
