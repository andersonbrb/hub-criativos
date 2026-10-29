import { randomBytes } from 'node:crypto';
import {
  IntegrationIdSchema,
  instagramRedirectUri,
  type IntegrationChannel,
  type IntegrationId,
  type IntegrationStatus,
} from '@sbs/contracts';
import type {
  ChangeChannelConnection,
  ChangeChannelMarket,
  ChannelRepository,
  LinkInstagramAccount,
  MarketRepository,
} from '@sbs/markets';
import { DomainError, NotFoundError, type Clock } from '@sbs/shared-kernel';

import { comOrganizacao, organizacaoAtual } from '@/features/acesso/servicos/organizacao-atual';
import type { NomeDaChave } from '@/features/integracoes/contrato';

import { PostgresDocumentStore, type Database } from '../infrastructure/database/postgres-document-store';
import {
  exchangeInstagramCode,
  instagramAuthorizeUrl,
} from '../infrastructure/integrations/instagram-oauth';
import {
  IntegrationCheckError,
  checkApify,
  type ProviderAccount,
} from '../infrastructure/integrations/provider-checks';
import { InstagramGraphClient } from '../infrastructure/integrations/instagram-graph-client';
import type { SecretBox } from '../infrastructure/integrations/secret-box';

/** Token de uma conta do Instagram (um por canal), como fica no banco. */
interface IntegrationDoc {
  id: string;
  version: number;
  /** Campos secretos, cifrados juntos (JSON). */
  sealed: string;
  publicValues: Record<string, string>;
  account: string | null;
  connectedAt: string;
}

/**
 * De onde vêm as credenciais no hub: as chaves coladas na tela Integrações (lerChave) e o login das contas do
 * HeyGen, do ElevenLabs e do FLORA (MCP). Injetado para os testes trocarem.
 */
export interface HubCredentials {
  key(name: NomeDaChave): Promise<string | null>;
  /** Login da conta do serviço ativo no hub (Integrações → HeyGen / ElevenLabs / FLORA). */
  mcpActive(service: 'heygen' | 'elevenlabs' | 'flora'): Promise<{ active: boolean; account: string | null }>;
}

export interface IntegrationsConfig {
  hub: HubCredentials;
  /** Endereço público do hub (HUB_PUBLIC_URL): base do retorno do login do Instagram. */
  publicUrl?: string | null;
  fetch?: typeof fetch;
}

const USAGE_CACHE_MS = 60_000;
const OAUTH_STATE_TTL_MS = 15 * 60_000;
const DAY_MS = 24 * 3600_000;
const channelDocId = (channelId: string) => `instagram-channel:${channelId}`;

const DISCONNECTED_MESSAGE: Record<IntegrationId, string> = {
  apify: 'Cole o token do Apify em Integrações para ler os posts das páginas de referência.',
  anthropic: 'Cole a chave da Anthropic em Integrações (Claude). Sem ela, a tradução e a revisão por IA usam o simulador de testes.',
  vmake:
    'Cole a Access Key e a Secret Key da vMake em Integrações. Sem elas, o vídeo segue com as legendas originais.',
  elevenlabs: 'Conecte a conta do ElevenLabs em Integrações: dublagem dos reels de narração e transcrição para os revisores.',
  heygen: 'Conecte a conta do HeyGen em Integrações: tradução dos reels com sincronia labial.',
  flora: 'Conecte a conta do FLORA em Integrações: adapta o texto dos slides e das capas.',
  instagram: 'Cole o ID e a chave secreta do app da Meta em Integrações e conecte a conta de cada canal aqui.',
  creative: 'A plataforma interna de criativos entra numa próxima etapa.',
};

const CONNECTED_MESSAGE: Record<IntegrationId, string> = {
  apify: 'Lê os posts públicos das páginas de referência conectadas.',
  anthropic: 'Em uso: adapta as legendas para cada mercado e faz a revisão por IA.',
  vmake: 'Em uso: primeira etapa dos reels, remove as legendas (cada vídeo consome cota da vMake).',
  elevenlabs: 'Em uso, com a conta conectada no hub: dubla os reels de narração.',
  heygen: 'Em uso, com a conta conectada no hub: traduz os reels com voz e sincronia labial.',
  flora: 'Em uso, com a conta conectada no hub: adapta o texto dos slides e das capas.',
  instagram:
    'App conectado. Em cada conta, ligue a “Publicação real” para as peças aprovadas irem ao ar; desligada, a publicação é simulada.',
  creative: '',
};

const IntegrationErrors = {
  inHub: () =>
    new DomainError(
      'integration_in_hub',
      'As chaves e os logins ficam na tela Integrações do hub. Conecte por lá.',
    ),
  instagramChannelNotConnected: () =>
    new DomainError(
      'instagram_channel_not_connected',
      'Conecte a conta do Instagram deste canal antes de ligar a publicação.',
    ),
  instagramAppMissing: () =>
    new DomainError(
      'instagram_app_not_connected',
      'Cole o ID e a chave secreta do app do Instagram em Integrações antes de conectar os canais.',
    ),
};

/**
 * Central de integrações do Instagram no hub. As chaves (Apify, vMake, Claude, app da Meta) e os logins (HeyGen,
 * ElevenLabs, FLORA) são os do hub, conectados na tela Integrações: aqui só se lê. O que é só do Instagram fica aqui:
 * o login oficial de cada conta (um por canal), com o token cifrado com a chave de segredos do hub.
 */
export class IntegrationsService {
  private readonly store: PostgresDocumentStore<IntegrationDoc>;
  private usageCache: { at: number; token: string; value: ProviderAccount | Error } | null = null;
  private readonly pendingOAuth = new Map<
    string,
    { marketId: string; redirectUri: string; expiresAt: number; organizacao: string }
  >();

  constructor(
    db: () => Database,
    private readonly box: SecretBox,
    private readonly clock: Clock,
    private readonly markets: {
      repo: MarketRepository;
      channels: ChannelRepository;
      changeChannelConnection: ChangeChannelConnection;
      linkInstagramAccount: LinkInstagramAccount;
      changeChannelMarket: ChangeChannelMarket;
    },
    private readonly config: IntegrationsConfig,
  ) {
    this.store = new PostgresDocumentStore(db, 'platform.integration', 'Integração');
  }

  // ── credenciais em tempo de execução ─────────────────────────────────────

  /** Valores da integração, ou null quando ela não está conectada no hub. */
  async credentials(id: IntegrationId): Promise<Record<string, string> | null> {
    const { hub } = this.config;
    switch (id) {
      case 'apify': {
        const token = await hub.key('apify');
        return token ? { token } : null;
      }
      case 'anthropic': {
        const apiKey = await hub.key('anthropic');
        return apiKey ? { apiKey } : null;
      }
      case 'vmake': {
        const [accessKey, secretKey] = await Promise.all([hub.key('vmake-access-key'), hub.key('vmake-secret-key')]);
        return accessKey && secretKey ? { accessKey, secretKey } : null;
      }
      case 'instagram': {
        const [appId, appSecret] = await Promise.all([hub.key('instagram-app-id'), hub.key('instagram-app-secret')]);
        return appId && appSecret ? { appId, appSecret } : null;
      }
      case 'heygen':
      case 'elevenlabs':
      case 'flora': {
        const { active, account } = await hub.mcpActive(id);
        return active ? { account: account ?? '' } : null;
      }
      case 'creative':
        return null;
    }
  }

  // ── painel ───────────────────────────────────────────────────────────────

  async list(): Promise<IntegrationStatus[]> {
    return Promise.all(IntegrationIdSchema.options.map((id) => this.status(id)));
  }

  async status(id: IntegrationId): Promise<IntegrationStatus> {
    const credentials = await this.credentials(id);
    const channels = id === 'instagram' ? await this.instagramChannels() : null;
    const base: IntegrationStatus = {
      id,
      status: 'disconnected',
      // As credenciais se conectam na tela Integrações do hub, não neste painel.
      configurable: false,
      source: credentials ? 'panel' : 'none',
      account: null,
      message: DISCONNECTED_MESSAGE[id],
      publicValues: id === 'instagram' && credentials ? { appId: credentials['appId'] ?? '' } : {},
      connectedAt: null,
      usage: null,
      channels,
    };
    if (!credentials) return base;

    const connected: IntegrationStatus = {
      ...base,
      status: 'connected',
      account:
        id === 'anthropic'
          ? `chave …${(credentials['apiKey'] ?? '').slice(-4)}`
          : (credentials['account'] ?? (id === 'instagram' ? `app ${credentials['appId']}` : null)),
      message: CONNECTED_MESSAGE[id],
    };
    if (id !== 'apify') return connected;

    // Apify cobra por uso: mostra o consumo do mês (verificado de novo a cada minuto).
    const usage = await this.apifyUsage(credentials['token'] ?? '');
    if (usage instanceof Error) return { ...connected, status: 'error', message: usage.message };
    return {
      ...connected,
      account: usage.account ?? connected.account,
      usage: usage.usage ?? null,
    };
  }

  private async apifyUsage(token: string): Promise<ProviderAccount | Error> {
    const now = this.clock.now().getTime();
    if (
      this.usageCache &&
      this.usageCache.token === token &&
      now - this.usageCache.at < USAGE_CACHE_MS
    ) {
      return this.usageCache.value;
    }
    let value: ProviderAccount | Error;
    try {
      value = await checkApify(token, this.config.fetch);
    } catch (error) {
      value = error instanceof Error ? error : new Error('Falha ao verificar o Apify.');
    }
    this.usageCache = { at: now, token, value };
    return value;
  }

  /** As chaves se colam na tela Integrações do hub (regra do dono: chave de integração fica na tela, num lugar só). */
  async connect(): Promise<IntegrationStatus> {
    throw IntegrationErrors.inHub();
  }

  async disconnect(): Promise<IntegrationStatus> {
    throw IntegrationErrors.inHub();
  }

  // ── Instagram: login por conta ───────────────────────────────────────────

  private async instagramChannels(): Promise<IntegrationChannel[]> {
    const [channels, markets] = await Promise.all([
      this.markets.channels.list(),
      this.markets.repo.list(),
    ]);
    const marketName = new Map(markets.map((m) => [m.id as string, m.name]));
    const result: IntegrationChannel[] = [];
    for (const channel of channels) {
      const doc = await this.store.get(channelDocId(channel.id));
      result.push({
        channelId: channel.id,
        handle: channel.handle,
        marketId: channel.marketId,
        marketName: marketName.get(channel.marketId) ?? '',
        status: doc && channel.connectionStatus === 'connected' ? 'connected' : 'disconnected',
        account: doc?.publicValues['username'] ?? null,
        expiresAt: doc?.publicValues['expiresAt'] ?? null,
        publishing: doc?.publicValues['publishing'] === 'on',
      });
    }
    return result;
  }

  /** Endereço de retorno do login do Instagram: o público do hub; sem ele, o da tela que pediu. */
  redirectUri(origin: string): string {
    return instagramRedirectUri(this.config.publicUrl || origin);
  }

  /**
   * Começa o login oficial do Instagram para uma conta do mercado escolhido: devolve a URL
   * para onde levar o navegador. A conta (e o @) só é conhecida no retorno.
   */
  async authorizeAccount(marketId: string, origin: string): Promise<string> {
    const app = await this.credentials('instagram');
    if (!app?.['appId'] || !app['appSecret']) throw IntegrationErrors.instagramAppMissing();
    if (!(await this.markets.repo.findById(marketId as never))) {
      throw new NotFoundError('Mercado', marketId);
    }

    const now = this.clock.now().getTime();
    for (const [key, pending] of this.pendingOAuth) {
      if (pending.expiresAt < now) this.pendingOAuth.delete(key);
    }
    const state = randomBytes(16).toString('hex');
    const redirectUri = this.redirectUri(origin);
    this.pendingOAuth.set(state, {
      marketId,
      redirectUri,
      expiresAt: now + OAUTH_STATE_TTL_MS,
      // O retorno chega sem sessão garantida: a conta entra na organização que começou o login.
      organizacao: await organizacaoAtual(),
    });
    return instagramAuthorizeUrl(app['appId'], redirectUri, state);
  }

  /**
   * Retorno do login: troca o código pelo token de 60 dias e liga a conta a um canal do
   * mercado escolhido, com o @ exatamente como o Instagram informa.
   */
  async completeAccountAuthorization(query: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }): Promise<{ ok: true; handle: string } | { ok: false; message: string }> {
    const pending = query.state ? this.pendingOAuth.get(query.state) : undefined;
    if (query.state) this.pendingOAuth.delete(query.state);
    if (query.error) {
      return {
        ok: false,
        message: query.error_description ?? 'O login no Instagram foi cancelado.',
      };
    }
    if (!pending || pending.expiresAt < this.clock.now().getTime() || !query.code) {
      return { ok: false, message: 'O login expirou ou não foi iniciado aqui. Tente de novo.' };
    }
    return comOrganizacao(pending.organizacao, () => this.linkAccount(pending, query.code!));
  }

  private async linkAccount(
    pending: { marketId: string; redirectUri: string },
    code: string,
  ): Promise<{ ok: true; handle: string } | { ok: false; message: string }> {
    const app = await this.credentials('instagram');
    if (!app?.['appId'] || !app['appSecret']) {
      return { ok: false, message: 'O app do Instagram não está mais conectado.' };
    }

    try {
      const token = await exchangeInstagramCode(
        { appId: app['appId'], appSecret: app['appSecret'] },
        code,
        pending.redirectUri,
        this.clock.now(),
        this.config.fetch,
      );
      const channel = await this.markets.linkInstagramAccount.execute({
        marketId: pending.marketId,
        username: token.username,
        externalAccountId: token.userId,
      });
      const id = channelDocId(channel.id);
      const existing = await this.store.get(id);
      await this.store.put({
        id,
        version: existing?.version ?? 0,
        sealed: this.box.seal(JSON.stringify({ accessToken: token.accessToken })),
        publicValues: {
          username: token.username,
          userId: token.userId,
          expiresAt: token.expiresAt,
          // Reconectar não muda a escolha de publicar de verdade.
          publishing: existing?.publicValues['publishing'] ?? 'off',
        },
        account: token.username,
        connectedAt: this.clock.now().toISOString(),
      });
      return { ok: true, handle: channel.handle };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof IntegrationCheckError || error instanceof DomainError
            ? error.message
            : 'Falha ao conectar a conta.',
      };
    }
  }

  /** O usuário escolhe a qual mercado (país) pertence a conta. */
  async changeChannelMarket(channelId: string, marketId: string): Promise<void> {
    await this.markets.changeChannelMarket.execute({ channelId, marketId });
  }

  /** Liga ou desliga a publicação real de um canal conectado. */
  async setChannelPublishing(channelId: string, enabled: boolean): Promise<void> {
    const id = channelDocId(channelId);
    const doc = await this.store.get(id);
    if (!doc) throw IntegrationErrors.instagramChannelNotConnected();
    await this.store.put({
      ...doc,
      publicValues: { ...doc.publicValues, publishing: enabled ? 'on' : 'off' },
    });
  }

  /**
   * Acesso de um canal para publicar. Faltando menos de 15 dias para o token vencer, renova
   * (o token precisa ter ao menos 24 h); se a renovação falhar, segue com o atual.
   */
  async instagramPublishing(
    channelId: string,
  ): Promise<{ userId: string; accessToken: string; enabled: boolean } | null> {
    const id = channelDocId(channelId);
    const doc = await this.store.get(id);
    const userId = doc?.publicValues['userId'];
    if (!doc || !userId) return null;
    let { accessToken } = JSON.parse(this.box.open(doc.sealed)) as { accessToken: string };
    const now = this.clock.now();
    const expiresAt = doc.publicValues['expiresAt'];
    const expiringSoon = expiresAt && new Date(expiresAt).getTime() - now.getTime() < 15 * DAY_MS;
    const oldEnough = now.getTime() - new Date(doc.connectedAt).getTime() > DAY_MS;
    if (expiringSoon && oldEnough) {
      try {
        const fresh = await new InstagramGraphClient(
          this.config.fetch ? { fetch: this.config.fetch } : {},
        ).refreshToken(accessToken, now);
        accessToken = fresh.accessToken;
        await this.store.put({
          ...doc,
          sealed: this.box.seal(JSON.stringify({ accessToken })),
          publicValues: { ...doc.publicValues, expiresAt: fresh.expiresAt },
          connectedAt: now.toISOString(),
        });
      } catch {
        // Renovação falhou: o token atual ainda vale até expirar.
      }
    }
    return { userId, accessToken, enabled: doc.publicValues['publishing'] === 'on' };
  }

  async disconnectChannel(channelId: string): Promise<void> {
    await this.store.delete(channelDocId(channelId));
    await this.markets.changeChannelConnection.execute({ channelId, externalAccountId: null });
  }
}
