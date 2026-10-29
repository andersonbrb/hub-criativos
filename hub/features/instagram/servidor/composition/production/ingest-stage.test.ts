import type { ProductionContext } from '@sbs/studio';
import { describe, expect, it, vi } from 'vitest';
import { MediaStorage, type MediaStore } from '../media-storage';
import { IngestReviewer, IngestSpecialist } from './ingest-stage';

const context = (format: 'reel' | 'carousel'): ProductionContext => ({
  contentPieceId: 'piece-1',
  referencePostId: 'ref-9',
  format,
  revisionNumber: 1,
  market: { marketId: 'm-es', locale: 'es-419', productName: 'San Benito' },
  suggestion: null,
  source: {
    caption: 'Oração',
    permalink: 'https://www.instagram.com/reel/X/',
    thumbnailUrl: 'https://scontent.cdninstagram.com/capa.jpg',
    mediaUrls: ['https://scontent.cdninstagram.com/video.mp4'],
  },
  media: {
    mediaUrls: ['https://scontent.cdninstagram.com/video.mp4'],
    coverUrl: 'https://scontent.cdninstagram.com/capa.jpg',
  },
  options: { videoTranslation: 'auto', heygenMode: 'speed', imageModel: null },
});

const BASE = 'https://hub.test/api/instagram/midia/org/assinatura/';

/** O armazenamento do hub em memória (gerações + Drive) e a CDN do Instagram. */
function fakeNetwork(options: { instagramStatus?: number } = {}) {
  const stored = new Map<string, string>();
  const store: MediaStore = {
    put: async (key, _body, type) => {
      stored.set(key, type);
      return `${BASE}${key}`;
    },
    exists: async (key) => stored.has(key),
    publicUrl: (key) => `${BASE}${key}`,
  };
  const media = {
    resolve: async () => ({ storage: store, label: 'armazenamento do hub (vídeo no Google Drive)' }),
  } as unknown as MediaStorage;
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.hostname === 'scontent.cdninstagram.com') {
      if (options.instagramStatus) return new Response('', { status: options.instagramStatus });
      const isVideo = url.pathname.endsWith('.mp4');
      return new Response(new Uint8Array(isVideo ? 2048 : 512), {
        headers: { 'content-type': isVideo ? 'video/mp4' : 'image/jpeg' },
      });
    }
    if (url.hostname === 'cdn.test') return new Response(null, { status: 404 });
    // Link permanente do hub: o próprio arquivo, com Range.
    if (String(input).startsWith(BASE)) {
      const type = stored.get(decodeURIComponent(String(input).slice(BASE.length)));
      return type
        ? new Response('x', {
            status: 206,
            headers: { 'content-type': type, 'content-range': 'bytes 0-0/10' },
          })
        : new Response(null, { status: 404 });
    }
    throw new Error(`não simulado: ${url}`);
  });
  return { stored, media, fetchFn: fetchFn as unknown as typeof fetch };
}

describe('etapa de armazenamento', () => {
  it('sem armazenamento (só nos testes), a etapa é pulada com o motivo', async () => {
    const media = new MediaStorage({ publicUrl: 'https://hub.test', secret: 's'.repeat(16), enabled: false });
    expect(await new IngestSpecialist(media).skipReason()).toMatch(/não configurado/);
  });

  it('guarda vídeo e capa por post e devolve links permanentes; não repete download', async () => {
    const { stored, media, fetchFn } = fakeNetwork();
    const specialist = new IngestSpecialist(media, fetchFn);

    const result = await specialist.run(context('reel'));

    expect(result.media.mediaUrls[0]).toBe(`${BASE}referencias/ref-9/video.mp4`);
    expect([...stored.keys()]).toEqual(['referencias/ref-9/video.mp4', 'referencias/ref-9/capa.jpg']);
    expect(result.summary).toMatch(/^2 arquivos guardados no armazenamento do hub/);
    expect((await specialist.run(context('reel'))).summary).toBe(
      '2 arquivos já estavam guardados no armazenamento do hub (vídeo no Google Drive).',
    );
  });

  it('download recusado pelo Instagram vira erro com instrução', async () => {
    const { media, fetchFn } = fakeNetwork({ instagramStatus: 403 });
    await expect(new IngestSpecialist(media, fetchFn).run(context('reel'))).rejects.toThrow(
      /recusou o download \(403\).*Sincronize/,
    );
  });

  it('o revisor confere que cada link abre e tem o tipo certo', async () => {
    const { media, fetchFn } = fakeNetwork();
    const result = await new IngestSpecialist(media, fetchFn).run(context('reel'));
    const reviewer = new IngestReviewer(fetchFn);

    expect(await reviewer.review(context('reel'), result)).toEqual({
      approved: true,
      notes: 'Todos os arquivos abrem pelo link permanente, com o tipo certo.',
    });
    const wrong = await reviewer.review(context('carousel'), result);
    expect(wrong.approved).toBe(false);
    expect(wrong.notes).toContain('Slide 1: tipo "video/mp4", esperado image.');
    expect(
      await reviewer.review(context('reel'), {
        ...result,
        media: { mediaUrls: ['https://cdn.test/nao-existe.mp4'], coverUrl: null },
      }),
    ).toEqual({ approved: false, notes: 'Vídeo: o link respondeu 404.' });
  });
});
