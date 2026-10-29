import { createHash } from 'node:crypto';
import type { PublishRequest, PublishResult, SocialPublisher } from '@sbs/publishing';
import { InstagramGraphClient } from '../infrastructure/integrations/instagram-graph-client';
import { IntegrationCheckError } from '../infrastructure/integrations/provider-checks';
import type { IntegrationsService } from './integrations';
import type { MediaStorage } from './media-storage';
import { directUrl } from './production/media-helpers';

type Fetch = typeof fetch;

export interface InstagramPublisherDeps {
  integrations: Pick<IntegrationsService, 'instagramPublishing'>;
  /** Usado enquanto a publicação real do canal está desligada. */
  simulated: SocialPublisher;
  /** Só mídia guardada no hub (links /api/instagram/midia/...) pode ir ao ar de verdade. */
  media: Pick<MediaStorage, 'resolve' | 'isOwnLink'>;
  fetch?: Fetch;
  client?: InstagramGraphClient;
}

/**
 * Publica no Instagram de verdade nos canais com a publicação real ligada; nos demais, segue
 * simulado. Só publica mídia que saiu da linha de produção (guardada na plataforma), nunca a
 * mídia simulada. Imagens vão em JPEG (o Instagram não aceita outro formato).
 */
export class InstagramSocialPublisher implements SocialPublisher {
  private readonly fetchFn: Fetch;
  private readonly client: InstagramGraphClient;

  constructor(private readonly deps: InstagramPublisherDeps) {
    this.fetchFn = deps.fetch ?? fetch;
    this.client = deps.client ?? new InstagramGraphClient({ fetch: this.fetchFn });
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const access = await this.deps.integrations.instagramPublishing(request.channelId);
    if (!access?.enabled) return this.deps.simulated.publish(request);

    const urls =
      request.assets.format === 'reel'
        ? [request.assets.videoUrl, ...(request.assets.coverUrl ? [request.assets.coverUrl] : [])]
        : request.assets.slideUrls;
    if (!urls.every((url) => this.deps.media.isOwnLink(url))) {
      throw new IntegrationCheckError(
        'A mídia desta peça não saiu da linha de produção (é simulada): não dá para publicar de verdade.',
      );
    }

    const account = { userId: access.userId, accessToken: access.accessToken };
    if (request.assets.format === 'reel') {
      return this.client.publishReel(account, {
        videoUrl: await directUrl(this.fetchFn, request.assets.videoUrl),
        coverUrl: request.assets.coverUrl ? await this.jpegUrl(request.assets.coverUrl) : null,
        caption: request.caption,
      });
    }
    const imageUrls: string[] = [];
    for (const slide of request.assets.slideUrls) imageUrls.push(await this.jpegUrl(slide));
    return this.client.publishCarousel(account, { imageUrls, caption: request.caption });
  }

  /** Link direto de uma imagem em JPEG; converte e guarda uma cópia quando é outro formato. */
  private async jpegUrl(url: string): Promise<string> {
    const response = await this.fetchFn(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok)
      throw new IntegrationCheckError(`Imagem da peça indisponível (${response.status}).`);
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (type === 'image/jpeg') {
      await response.body?.cancel().catch(() => undefined);
      return directUrl(this.fetchFn, url);
    }
    const resolved = await this.deps.media.resolve();
    if (!resolved) throw new IntegrationCheckError('Armazenamento de mídia não configurado.');
    const { default: sharp } = await import('sharp');
    const jpeg = await sharp(Buffer.from(await response.arrayBuffer()))
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 92 })
      .toBuffer();
    const key = `publicar/${createHash('sha1').update(url).digest('hex').slice(0, 16)}.jpg`;
    const stored = await resolved.storage.put(
      key,
      jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) as ArrayBuffer,
      'image/jpeg',
    );
    return directUrl(this.fetchFn, stored);
  }
}
