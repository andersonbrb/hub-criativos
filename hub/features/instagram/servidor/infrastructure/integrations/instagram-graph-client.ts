import type { PollingOptions } from './polling';
import { IntegrationCheckError } from './provider-checks';

type Fetch = typeof fetch;
const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const GRAPH = 'https://graph.instagram.com/v23.0';

export interface InstagramAccount {
  /** Id da conta profissional (o `user_id` do login). */
  userId: string;
  accessToken: string;
}

export interface PublishedMedia {
  externalMediaId: string;
  permalink: string;
}

/**
 * Publicação pela Instagram API with Instagram Login: cria o contêiner de mídia, espera o
 * Instagram processar e publica. As mídias precisam estar em links públicos (vídeo MP4,
 * imagens JPEG).
 */
export class InstagramGraphClient {
  private readonly fetchFn: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(options: PollingOptions = {}) {
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? realSleep;
    this.pollMs = options.pollMs ?? 10_000;
    this.timeoutMs = options.timeoutMs ?? 15 * 60_000;
  }

  async publishReel(
    account: InstagramAccount,
    input: { videoUrl: string; coverUrl: string | null; caption: string },
  ): Promise<PublishedMedia> {
    const container = await this.createContainer(account, {
      media_type: 'REELS',
      video_url: input.videoUrl,
      caption: input.caption,
      share_to_feed: 'true',
      ...(input.coverUrl ? { cover_url: input.coverUrl } : {}),
    });
    await this.waitUntilReady(account, container);
    return this.publishContainer(account, container);
  }

  async publishCarousel(
    account: InstagramAccount,
    input: { imageUrls: string[]; caption: string },
  ): Promise<PublishedMedia> {
    if (input.imageUrls.length < 2 || input.imageUrls.length > 10) {
      throw new IntegrationCheckError(
        `O Instagram aceita carrossel de 2 a 10 imagens (esta peça tem ${input.imageUrls.length}).`,
      );
    }
    const children: string[] = [];
    for (const imageUrl of input.imageUrls) {
      const child = await this.createContainer(account, {
        image_url: imageUrl,
        is_carousel_item: 'true',
      });
      await this.waitUntilReady(account, child);
      children.push(child);
    }
    const container = await this.createContainer(account, {
      media_type: 'CAROUSEL',
      children: children.join(','),
      caption: input.caption,
    });
    await this.waitUntilReady(account, container);
    return this.publishContainer(account, container);
  }

  /** Renova o token longo (dura mais 60 dias). Só funciona com token de 24 h ou mais. */
  async refreshToken(
    accessToken: string,
    now: Date,
  ): Promise<{ accessToken: string; expiresAt: string }> {
    const body = await this.call(
      'GET',
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: 'ig_refresh_token',
        access_token: accessToken,
      })}`,
    );
    const token = typeof body['access_token'] === 'string' ? body['access_token'] : null;
    const expiresIn = typeof body['expires_in'] === 'number' ? body['expires_in'] : null;
    if (!token || !expiresIn) throw new IntegrationCheckError('O Instagram não renovou o acesso.');
    return {
      accessToken: token,
      expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    };
  }

  private async createContainer(account: InstagramAccount, fields: Record<string, string>) {
    const body = await this.call('POST', `${GRAPH}/${encodeURIComponent(account.userId)}/media`, {
      ...fields,
      access_token: account.accessToken,
    });
    const id = typeof body['id'] === 'string' ? body['id'] : null;
    if (!id) throw new IntegrationCheckError('O Instagram não criou a mídia para publicar.');
    return id;
  }

  /** Espera o Instagram baixar e processar a mídia do contêiner. */
  private async waitUntilReady(account: InstagramAccount, containerId: string) {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const body = await this.call(
        'GET',
        `${GRAPH}/${encodeURIComponent(containerId)}?${new URLSearchParams({
          fields: 'status_code,status',
          access_token: account.accessToken,
        })}`,
      );
      const code = body['status_code'];
      if (code === 'FINISHED' || code === 'PUBLISHED') return;
      if (code === 'ERROR' || code === 'EXPIRED') {
        const detail = typeof body['status'] === 'string' ? body['status'] : String(code);
        throw new IntegrationCheckError(`O Instagram não conseguiu processar a mídia: ${detail}.`);
      }
      if (Date.now() > deadline) {
        throw new IntegrationCheckError('O Instagram demorou demais para processar a mídia.');
      }
      await this.sleep(this.pollMs);
    }
  }

  private async publishContainer(
    account: InstagramAccount,
    containerId: string,
  ): Promise<PublishedMedia> {
    const published = await this.call(
      'POST',
      `${GRAPH}/${encodeURIComponent(account.userId)}/media_publish`,
      { creation_id: containerId, access_token: account.accessToken },
    );
    const mediaId = typeof published['id'] === 'string' ? published['id'] : null;
    if (!mediaId) throw new IntegrationCheckError('O Instagram não confirmou a publicação.');
    const media = await this.call(
      'GET',
      `${GRAPH}/${encodeURIComponent(mediaId)}?${new URLSearchParams({
        fields: 'permalink',
        access_token: account.accessToken,
      })}`,
    ).catch(() => ({}) as Record<string, unknown>);
    return {
      externalMediaId: mediaId,
      permalink:
        typeof media['permalink'] === 'string' ? media['permalink'] : 'https://www.instagram.com/',
    };
  }

  private async call(
    method: 'GET' | 'POST',
    url: string,
    form?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        ...(form
          ? {
              headers: { 'content-type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams(form).toString(),
            }
          : {}),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new IntegrationCheckError('Sem resposta do Instagram. Tente de novo.');
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || body['error']) throw instagramError(body['error']);
    return body;
  }
}

/** Erro da Graph API em português, com o que fazer. */
function instagramError(raw: unknown): IntegrationCheckError {
  const error = (raw ?? {}) as {
    message?: string;
    code?: number;
    error_user_msg?: string;
  };
  if (error.code === 190) {
    return new IntegrationCheckError(
      'O acesso à conta do Instagram expirou ou foi revogado: conecte a conta de novo em Integrações.',
    );
  }
  if (error.code === 4 || error.code === 17 || error.code === 32 || error.code === 613) {
    return new IntegrationCheckError(
      'Limite de publicações do Instagram atingido (até 100 por dia). Tente de novo mais tarde.',
    );
  }
  const detail = error.error_user_msg || error.message || 'erro desconhecido';
  return new IntegrationCheckError(`O Instagram recusou a publicação: ${detail}`);
}
