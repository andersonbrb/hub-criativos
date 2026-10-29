import { describe, expect, it, vi } from 'vitest';
import { ApifyReferenceFeed, UnconfiguredReferenceFeed } from './apify-reference-feed';

const source = { id: 'src-1', handle: 'santaespiritualidade' };

const reel = {
  id: '3700000000000000001',
  type: 'Video',
  shortCode: 'DReel001',
  url: 'https://www.instagram.com/reel/DReel001/',
  caption: 'Oração da manhã',
  displayUrl: 'https://scontent.cdninstagram.com/reel-cover.jpg',
  videoUrl: 'https://scontent.cdninstagram.com/reel.mp4',
  timestamp: '2026-10-10T12:00:00.000Z',
  likesCount: 1200,
  commentsCount: 80,
  videoPlayCount: 45000,
  ownerUsername: 'santaespiritualidade',
};

const carousel = {
  id: '3700000000000000002',
  type: 'Sidecar',
  shortCode: 'DCar002',
  url: 'https://www.instagram.com/p/DCar002/',
  caption: null,
  displayUrl: 'https://scontent.cdninstagram.com/c-1.jpg',
  childPosts: [
    { displayUrl: 'https://scontent.cdninstagram.com/c-1.jpg' },
    { displayUrl: 'https://scontent.cdninstagram.com/c-2.jpg' },
  ],
  timestamp: '2026-10-09T12:00:00.000Z',
  likesCount: -1,
  commentsCount: 15,
  ownerUsername: 'SantaEspiritualidade',
};

function respond(body: unknown, status = 201) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe('ApifyReferenceFeed', () => {
  it('pede ao Apify só o perfil cadastrado e converte os posts', async () => {
    const fetch = respond([reel, carousel]);
    const feed = new ApifyReferenceFeed({ token: 'tok', resultsLimit: 30, fetch });

    const posts = await feed.fetchRecent(source);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items',
    );
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok' });
    expect(JSON.parse(init.body as string)).toEqual({
      directUrls: ['https://www.instagram.com/santaespiritualidade/'],
      resultsType: 'posts',
      resultsLimit: 30,
      addParentData: false,
    });

    expect(posts).toEqual([
      {
        externalId: reel.id,
        format: 'reel',
        caption: 'Oração da manhã',
        permalink: reel.url,
        thumbnailUrl: reel.displayUrl,
        mediaUrls: [reel.videoUrl],
        publishedAt: new Date(reel.timestamp),
        metrics: { views: 45000, reach: 0, likes: 1200, comments: 80, saves: 0, shares: 0 },
      },
      {
        externalId: carousel.id,
        format: 'carousel',
        caption: '',
        permalink: carousel.url,
        thumbnailUrl: carousel.displayUrl,
        mediaUrls: [
          'https://scontent.cdninstagram.com/c-1.jpg',
          'https://scontent.cdninstagram.com/c-2.jpg',
        ],
        publishedAt: new Date(carousel.timestamp),
        // Curtidas ocultas (-1) viram 0.
        metrics: { views: 0, reach: 0, likes: 0, comments: 15, saves: 0, shares: 0 },
      },
    ]);
  });

  it('descarta posts de qualquer outra conta (colaborações, marcações, outros perfis)', async () => {
    const feed = new ApifyReferenceFeed({
      token: 'tok',
      fetch: respond([
        reel,
        { ...reel, id: '9', ownerUsername: 'outra.pagina' },
        { ...reel, id: '10', ownerUsername: undefined },
      ]),
    });

    const posts = await feed.fetchRecent(source);
    expect(posts.map((p) => p.externalId)).toEqual([reel.id]);
  });

  it('ignora itens sem mídia ou data', async () => {
    const feed = new ApifyReferenceFeed({
      token: 'tok',
      fetch: respond([
        reel,
        { ...reel, id: '11', displayUrl: undefined },
        { ...reel, id: '12', timestamp: 'x' },
      ]),
    });
    expect(await feed.fetchRecent(source)).toHaveLength(1);
  });

  it('explica quando o perfil não pôde ser lido', async () => {
    const feed = new ApifyReferenceFeed({
      token: 'tok',
      fetch: respond([{ error: 'not_found', errorDescription: 'Perfil não existe ou é privado.' }]),
    });
    await expect(feed.fetchRecent(source)).rejects.toMatchObject({
      code: 'reference_feed_unavailable',
      message: expect.stringContaining('Perfil não existe ou é privado.'),
    });
  });

  it('explica quando o token é recusado ou o Apify falha', async () => {
    const denied = new ApifyReferenceFeed({ token: 'x', fetch: respond({}, 401) });
    await expect(denied.fetchRecent(source)).rejects.toMatchObject({
      code: 'reference_feed_unavailable',
      message: expect.stringContaining('APIFY_TOKEN'),
    });

    const broken = new ApifyReferenceFeed({ token: 'x', fetch: respond({}, 500) });
    await expect(broken.fetchRecent(source)).rejects.toMatchObject({
      code: 'reference_feed_unavailable',
    });

    const offline = new ApifyReferenceFeed({
      token: 'x',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    await expect(offline.fetchRecent(source)).rejects.toMatchObject({
      code: 'reference_feed_unavailable',
    });
  });
});

describe('UnconfiguredReferenceFeed', () => {
  it('falha com mensagem clara em vez de inventar posts', async () => {
    await expect(new UnconfiguredReferenceFeed().fetchRecent()).rejects.toMatchObject({
      code: 'reference_feed_not_configured',
    });
  });
});
