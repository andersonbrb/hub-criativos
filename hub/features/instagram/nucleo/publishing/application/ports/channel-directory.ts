import type { PostingSlot } from '../../domain';

/** Para onde e quando publicar num canal. */
export interface PostingTarget {
  channelId: string;
  marketId: string;
  /** Fuso IANA do mercado dono do canal. */
  timezone: string;
  postingPlan: PostingSlot[];
  /** Id da conta no Instagram; `null` enquanto o canal não está conectado. */
  externalAccountId: string | null;
}

/** Leitura dos canais (contexto de Mercados), ligada no composition root. */
export interface ChannelDirectory {
  /** Lança `NotFoundError` se o canal não existe. */
  getPostingTarget(channelId: string): Promise<PostingTarget>;
}
