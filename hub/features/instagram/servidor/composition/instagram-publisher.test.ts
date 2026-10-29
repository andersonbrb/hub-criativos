import type { PublishRequest, SocialPublisher } from '@sbs/publishing';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { InstagramGraphClient } from '../infrastructure/integrations/instagram-graph-client';
import { InstagramSocialPublisher } from './instagram-publisher';
import type { MediaStorage } from './media-storage';

const PUBLIC = 'https://agente.test';
const reel: PublishRequest = {
  channelId: 'ch-es',
  channelExternalAccountId: '1784',
  format: 'reel',
  assets: {
    format: 'reel',
    videoUrl: `${PUBLIC}/media/sig/pecas/p1/video.mp4`,
    coverUrl: `${PUBLIC}/media/sig/pecas/p1/capa.png`,
  },
  caption: 'Oración',
};

async function setup(options: { enabled?: boolean | null } = {}) {
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer();
  const stored: { key: string; type: string; bytes: Buffer }[] = [];
  // Links da plataforma redirecionam para o bucket; o bucket entrega o arquivo.
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${PUBLIC}/media/`)) {
      const key = url.split('/media/sig/')[1]!;
      if (init?.redirect === 'manual') {
        return new Response(null, {
          status: 302,
          headers: { location: `https://bucket.test/${key}` },
        });
      }
      return key.endsWith('.png')
        ? new Response(png, { headers: { 'content-type': 'image/png' } })
        : new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } });
    }
    throw new Error(`não simulado: ${url}`);
  }) as unknown as typeof fetch;
  const simulated: SocialPublisher = {
    publish: vi.fn(async () => ({ externalMediaId: 'fake-1', permalink: 'https://simulado/' })),
  };
  const client = {
    publishReel: vi.fn(async () => ({ externalMediaId: 'm-1', permalink: 'https://ig/reel/1' })),
    publishCarousel: vi.fn(async () => ({ externalMediaId: 'm-2', permalink: 'https://ig/p/2' })),
  };
  const publisher = new InstagramSocialPublisher({
    integrations: {
      instagramPublishing: async () =>
        options.enabled === null
          ? null
          : { userId: '1784', accessToken: 'TOKEN', enabled: options.enabled ?? true },
    },
    simulated,
    media: {
      resolve: async () => ({
        storage: {
          put: async (key: string, body: ArrayBuffer, type: string) => {
            stored.push({ key, type, bytes: Buffer.from(body) });
            return `${PUBLIC}/media/sig/${key}`;
          },
        },
        label: 'bucket',
      }),
      isOwnLink: (url: string) => url.startsWith(`${PUBLIC}/media/`),
    } as unknown as Pick<MediaStorage, 'resolve' | 'isOwnLink'>,
    fetch: fetchFn,
    client: client as unknown as InstagramGraphClient,
  });
  return { publisher, simulated, client, stored };
}

describe('InstagramSocialPublisher', () => {
  it('publicação real desligada (ou conta sem login): segue simulada', async () => {
    for (const enabled of [false, null]) {
      const { publisher, simulated, client } = await setup({ enabled });
      expect(await publisher.publish(reel)).toEqual({
        externalMediaId: 'fake-1',
        permalink: 'https://simulado/',
      });
      expect(simulated.publish).toHaveBeenCalledOnce();
      expect(client.publishReel).not.toHaveBeenCalled();
    }
  });

  it('não publica de verdade mídia que não saiu da linha de produção', async () => {
    const { publisher, client } = await setup();
    await expect(
      publisher.publish({
        ...reel,
        assets: { format: 'reel', videoUrl: 'https://picsum.photos/v.mp4', coverUrl: null },
      }),
    ).rejects.toThrow('não saiu da linha de produção');
    expect(client.publishReel).not.toHaveBeenCalled();
  });

  it('reel: manda o link direto do vídeo e a capa convertida para JPEG', async () => {
    const { publisher, client, stored } = await setup();

    const result = await publisher.publish(reel);

    expect(result).toEqual({ externalMediaId: 'm-1', permalink: 'https://ig/reel/1' });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.type).toBe('image/jpeg');
    expect((await sharp(stored[0]!.bytes).metadata()).format).toBe('jpeg');
    expect(client.publishReel).toHaveBeenCalledWith(
      { userId: '1784', accessToken: 'TOKEN' },
      {
        videoUrl: 'https://bucket.test/pecas/p1/video.mp4',
        coverUrl: `https://bucket.test/${stored[0]!.key}`,
        caption: 'Oración',
      },
    );
  });

  it('carrossel: imagens JPEG seguem como estão', async () => {
    const { publisher, client, stored } = await setup();
    await publisher.publish({
      ...reel,
      format: 'carousel',
      assets: {
        format: 'carousel',
        slideUrls: [`${PUBLIC}/media/sig/a/1.jpg`, `${PUBLIC}/media/sig/a/2.jpg`],
      },
    });
    expect(stored).toEqual([]);
    expect(client.publishCarousel).toHaveBeenCalledWith(expect.anything(), {
      imageUrls: ['https://bucket.test/a/1.jpg', 'https://bucket.test/a/2.jpg'],
      caption: 'Oración',
    });
  });
});
