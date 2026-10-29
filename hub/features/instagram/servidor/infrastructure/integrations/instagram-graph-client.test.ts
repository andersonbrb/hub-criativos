import { describe, expect, it, vi } from 'vitest';
import { InstagramGraphClient } from './instagram-graph-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Graph API simulada: guarda as chamadas e responde por método + caminho, em fila. */
function fakeGraph(routes: Record<string, Response[]>) {
  const calls: { method: string; path: string; form: Record<string, string> }[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace('/v23.0', '');
    calls.push({
      method,
      path,
      form: Object.fromEntries(new URLSearchParams(String(init?.body ?? ''))),
    });
    const queue = routes[`${method} ${path}`];
    if (!queue?.length) throw new Error(`não simulado: ${method} ${path}`);
    return queue.length > 1 ? queue.shift()! : queue[0]!.clone();
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

const account = { userId: '1784', accessToken: 'TOKEN' };
const client = (fetchFn: typeof fetch) =>
  new InstagramGraphClient({ fetch: fetchFn, sleep: async () => undefined });

describe('InstagramGraphClient', () => {
  it('reel: cria o contêiner, espera processar, publica e busca o link', async () => {
    const { fetchFn, calls } = fakeGraph({
      'POST /1784/media': [json({ id: 'c-1' })],
      'GET /c-1': [json({ status_code: 'IN_PROGRESS' }), json({ status_code: 'FINISHED' })],
      'POST /1784/media_publish': [json({ id: 'm-1' })],
      'GET /m-1': [json({ permalink: 'https://www.instagram.com/reel/ABC/' })],
    });

    const result = await client(fetchFn).publishReel(account, {
      videoUrl: 'https://bucket.test/video.mp4',
      coverUrl: 'https://bucket.test/capa.jpg',
      caption: 'Oración 🙏 #sanbenito',
    });

    expect(result).toEqual({
      externalMediaId: 'm-1',
      permalink: 'https://www.instagram.com/reel/ABC/',
    });
    expect(calls[0]!.form).toEqual({
      media_type: 'REELS',
      video_url: 'https://bucket.test/video.mp4',
      caption: 'Oración 🙏 #sanbenito',
      share_to_feed: 'true',
      cover_url: 'https://bucket.test/capa.jpg',
      access_token: 'TOKEN',
    });
    expect(calls.find((c) => c.path === '/1784/media_publish')!.form).toEqual({
      creation_id: 'c-1',
      access_token: 'TOKEN',
    });
  });

  it('carrossel: um contêiner por imagem e o carrossel com os filhos', async () => {
    const { fetchFn, calls } = fakeGraph({
      'POST /1784/media': [json({ id: 'i-1' }), json({ id: 'i-2' }), json({ id: 'car-1' })],
      'GET /i-1': [json({ status_code: 'FINISHED' })],
      'GET /i-2': [json({ status_code: 'FINISHED' })],
      'GET /car-1': [json({ status_code: 'FINISHED' })],
      'POST /1784/media_publish': [json({ id: 'm-2' })],
      'GET /m-2': [json({ permalink: 'https://www.instagram.com/p/XYZ/' })],
    });

    await client(fetchFn).publishCarousel(account, {
      imageUrls: ['https://bucket.test/1.jpg', 'https://bucket.test/2.jpg'],
      caption: 'Legenda',
    });

    const creates = calls.filter((c) => c.path === '/1784/media').map((c) => c.form);
    expect(creates[0]).toMatchObject({
      image_url: 'https://bucket.test/1.jpg',
      is_carousel_item: 'true',
    });
    expect(creates[2]).toMatchObject({
      media_type: 'CAROUSEL',
      children: 'i-1,i-2',
      caption: 'Legenda',
    });
  });

  it('carrossel fora de 2 a 10 imagens é recusado antes de chamar o Instagram', async () => {
    const { fetchFn, calls } = fakeGraph({});
    await expect(
      client(fetchFn).publishCarousel(account, {
        imageUrls: ['https://x.test/1.jpg'],
        caption: '',
      }),
    ).rejects.toThrow('O Instagram aceita carrossel de 2 a 10 imagens');
    expect(calls).toEqual([]);
  });

  it('explica token expirado e mídia que o Instagram não processou', async () => {
    const expired = fakeGraph({
      'POST /1784/media': [
        json({ error: { message: 'Error validating access token', code: 190 } }, 400),
      ],
    });
    await expect(
      client(expired.fetchFn).publishReel(account, {
        videoUrl: 'https://x.test/v.mp4',
        coverUrl: null,
        caption: '',
      }),
    ).rejects.toThrow('conecte a conta de novo em Integrações');

    const broken = fakeGraph({
      'POST /1784/media': [json({ id: 'c-9' })],
      'GET /c-9': [json({ status_code: 'ERROR', status: 'Formato de vídeo não suportado' })],
    });
    await expect(
      client(broken.fetchFn).publishReel(account, {
        videoUrl: 'https://x.test/v.mp4',
        coverUrl: null,
        caption: '',
      }),
    ).rejects.toThrow(
      'O Instagram não conseguiu processar a mídia: Formato de vídeo não suportado.',
    );
  });

  it('renova o token longo', async () => {
    const { fetchFn } = fakeGraph({
      'GET /refresh_access_token': [json({ access_token: 'NOVO', expires_in: 5_184_000 })],
    });
    const fresh = await client(fetchFn).refreshToken('TOKEN', new Date('2026-10-23T00:00:00.000Z'));
    expect(fresh).toEqual({ accessToken: 'NOVO', expiresAt: '2026-12-22T00:00:00.000Z' });
  });
});
