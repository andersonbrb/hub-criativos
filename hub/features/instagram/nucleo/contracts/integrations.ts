import { z } from 'zod';
import { IsoDateTime } from './common';

export const IntegrationIdSchema = z.enum([
  'apify',
  'anthropic',
  'vmake',
  'elevenlabs',
  'heygen',
  'flora',
  'instagram',
  'creative',
]);
export type IntegrationId = z.infer<typeof IntegrationIdSchema>;

export interface IntegrationField {
  key: string;
  label: string;
  /** Segredos são gravados cifrados e nunca voltam para o painel. */
  secret: boolean;
  placeholder: string;
  help: string;
}

/**
 * Campos que cada integração pede no painel. O servidor valida a credencial com o próprio
 * serviço antes de salvar. `creative` (plataforma interna) ainda não tem campos: chega depois.
 */
export const INTEGRATION_FIELDS: Record<IntegrationId, readonly IntegrationField[]> = {
  apify: [
    {
      key: 'token',
      label: 'Token da API',
      secret: true,
      placeholder: 'apify_api_…',
      help: 'Apify → Settings → API & Integrations → Personal API tokens.',
    },
  ],
  anthropic: [
    {
      key: 'apiKey',
      label: 'Chave da API',
      secret: true,
      placeholder: 'sk-ant-…',
      help: 'Claude Console → Settings → API keys.',
    },
  ],
  elevenlabs: [
    {
      key: 'apiKey',
      label: 'Chave da API',
      secret: true,
      placeholder: 'sk_…',
      help: 'ElevenLabs → Developers → API Keys.',
    },
  ],
  heygen: [
    {
      key: 'apiKey',
      label: 'Chave da API',
      secret: true,
      placeholder: 'Chave do HeyGen',
      help: 'HeyGen → Settings → API.',
    },
  ],
  vmake: [
    {
      key: 'accessKey',
      label: 'Access Key',
      secret: false,
      placeholder: 'Access Key da vMake',
      help: 'vMake → Developers → API Key (o par Access Key + Secret Key).',
    },
    {
      key: 'secretKey',
      label: 'Secret Key',
      secret: true,
      placeholder: 'Secret Key da vMake',
      help: 'Aparece junto da Access Key em vmake.ai/developers.',
    },
  ],
  flora: [
    {
      key: 'apiKey',
      label: 'Chave da API',
      secret: true,
      placeholder: 'ak_…',
      help: 'FLORA → Settings → API keys (planos com acesso à API).',
    },
  ],
  instagram: [
    {
      key: 'appId',
      label: 'ID do app (Instagram App ID)',
      secret: false,
      placeholder: '990602627938098',
      help: 'Meta for Developers → seu app → Instagram → API setup with Instagram login.',
    },
    {
      key: 'appSecret',
      label: 'Chave secreta do app (Instagram App Secret)',
      secret: true,
      placeholder: 'Chave secreta',
      help: 'Na mesma tela do ID do app.',
    },
  ],
  creative: [],
};

export const IntegrationChannelSchema = z.object({
  channelId: z.string(),
  /** @ exatamente como o Instagram informou no login. */
  handle: z.string(),
  marketId: z.string(),
  marketName: z.string(),
  status: z.enum(['connected', 'disconnected']),
  /** @ da conta do Instagram que autorizou. */
  account: z.string().nullable(),
  expiresAt: IsoDateTime.nullable(),
  /** Publicação real ligada (desligada, a publicação é simulada). */
  publishing: z.boolean(),
});
export type IntegrationChannel = z.infer<typeof IntegrationChannelSchema>;

/** Estado de uma integração externa, verificado no servidor. */
export const IntegrationStatusSchema = z.object({
  id: IntegrationIdSchema,
  status: z.enum(['connected', 'disconnected', 'error']),
  /** Configurável pelo painel (a plataforma de criativos ainda não). */
  configurable: z.boolean(),
  /** De onde vem a credencial: painel, variável de ambiente do servidor ou nenhuma. */
  source: z.enum(['panel', 'env', 'none']),
  /** Conta conectada (ex.: usuário do Apify). */
  account: z.string().nullable(),
  /** Detalhe para quem lê: o que está em uso ou por que falhou. */
  message: z.string().nullable(),
  /** Valores não secretos já salvos (ex.: ID do app do Instagram). */
  publicValues: z.record(z.string(), z.string()),
  connectedAt: IsoDateTime.nullable(),
  /** Consumo do ciclo mensal, quando a integração cobra por uso. */
  usage: z
    .object({
      usedUsd: z.number().nonnegative(),
      limitUsd: z.number().nonnegative(),
      cycleEndsAt: IsoDateTime,
    })
    .nullable(),
  /** Instagram: um login por canal dos mercados. */
  channels: z.array(IntegrationChannelSchema).nullable(),
});
export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const ConnectIntegrationInputSchema = z.object({
  values: z.record(z.string(), z.string().trim()),
});
export type ConnectIntegrationInput = z.infer<typeof ConnectIntegrationInputSchema>;

export const InstagramAuthorizeInputSchema = z.object({
  /** Origem do painel (https://…): vira o endereço de retorno do login do Instagram. */
  origin: z.url(),
  /** Mercado (país) a que a conta vai pertencer. */
  marketId: z.string().min(1),
});

export const ChangeChannelMarketInputSchema = z.object({ marketId: z.string().min(1) });
export type ChangeChannelMarketInput = z.infer<typeof ChangeChannelMarketInputSchema>;
export type InstagramAuthorizeInput = z.infer<typeof InstagramAuthorizeInputSchema>;

export const InstagramAuthorizeResultSchema = z.object({ url: z.url() });
export type InstagramAuthorizeResult = z.infer<typeof InstagramAuthorizeResultSchema>;

/** Endereço que precisa estar cadastrado no app da Meta como "OAuth redirect URI" (no hub, sob /api/instagram). */
export function instagramRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/instagram/integrations/instagram/callback`;
}

/** Modelos da FLORA que adaptam imagens, para escolher ao selecionar um post. */
export const FloraImageModelsSchema = z.object({
  connected: z.boolean(),
  /** Usado quando a seleção não escolhe um modelo. */
  defaultModel: z.string(),
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      costUsd: z.number().nullable(),
      seconds: z.number().nullable(),
    }),
  ),
});
export type FloraImageModels = z.infer<typeof FloraImageModelsSchema>;

export const ChannelPublishingInputSchema = z.object({ enabled: z.boolean() });
export type ChannelPublishingInput = z.infer<typeof ChannelPublishingInputSchema>;
