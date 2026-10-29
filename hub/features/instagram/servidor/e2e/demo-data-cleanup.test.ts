import type { DemoDataSummary, Market, ReferencePost } from '@sbs/contracts';
import { FakeReferenceFeed, type FeedPost, type ReferenceFeed } from '@sbs/reference';
import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContainer, fakeAdapters, type Container } from '../composition/container';
import { seedDemoData } from '../composition/seed-demo';
import { buildServer, type Server } from '../http/server';
import { asUser, openTestDatabase, testPlatform } from './test-env';

const REAL_POST: FeedPost = {
  externalId: 'real-1',
  format: 'reel',
  caption: 'Post real da conta',
  permalink: 'https://www.instagram.com/reel/REAL1/',
  thumbnailUrl: 'https://scontent.cdninstagram.com/real.jpg',
  mediaUrls: ['https://scontent.cdninstagram.com/real.mp4'],
  publishedAt: new Date('2026-10-10T12:00:00.000Z'),
  // Desempenho baixo: fica fora da seleção automática do seed.
  metrics: { views: 1000, reach: 1000, likes: 1, comments: 0, saves: 0, shares: 0 },
};

/** Feed de exemplo (picsum.photos) + um post "real" (CDN do Instagram). */
class MixedFeed implements ReferenceFeed {
  private readonly fake = new FakeReferenceFeed();
  async fetchRecent(source: { id: string; handle: string }, now: Date): Promise<FeedPost[]> {
    return [...(await this.fake.fetchRecent(source, now)), REAL_POST];
  }
}

describe('remoção dos dados de demonstração (API + banco)', () => {
  let handle: Awaited<ReturnType<typeof openTestDatabase>>;
  let container: Container;
  let server: Server;

  const call = async <T>(method: 'GET' | 'DELETE', url: string, role = 'admin') => {
    const res = await server.inject({ method, url, headers: asUser(role) });
    return { status: res.statusCode, body: res.json() as T };
  };

  beforeAll(async () => {
    handle = await openTestDatabase();
    container = createContainer({
      db: handle.db,
      clock: new FixedClock('2026-10-15T12:00:00.000Z'),
      ids: new SequentialIdGenerator('id'),
      logger: { error: (obj) => console.error(obj) },
      platform: testPlatform(),
      adapters: { ...fakeAdapters(), referenceFeed: new MixedFeed() },
    });
    server = await buildServer(container);
    await seedDemoData(container, { runPipeline: true });
  }, 60_000);

  afterAll(async () => {
    container.jobs.close();
    await server.close();
    await handle.close();
  });

  it('só o admin consulta ou remove', async () => {
    expect((await call('GET', '/admin/demo-data', 'reviewer')).status).toBe(403);
    expect((await call('DELETE', '/admin/demo-data', 'reviewer')).status).toBe(403);
  });

  it('conta os posts de exemplo e o que derivou deles', async () => {
    const { status, body } = await call<DemoDataSummary>('GET', '/admin/demo-data');
    expect(status).toBe(200);
    expect(body.posts).toBe(12);
    expect(body.adaptations).toBeGreaterThan(0);
    expect(body.reviews).toBeGreaterThan(0);
    expect(body.events).toBeGreaterThan(0);
  });

  it('remove só a demonstração: post real, mercados e conta de referência ficam', async () => {
    const before = (await call<DemoDataSummary>('GET', '/admin/demo-data')).body;

    const purge = await call<DemoDataSummary>('DELETE', '/admin/demo-data');
    expect(purge.status).toBe(200);
    expect(purge.body).toEqual(before);

    expect((await call<DemoDataSummary>('GET', '/admin/demo-data')).body).toEqual({
      posts: 0,
      adaptations: 0,
      reviews: 0,
      publications: 0,
      events: 0,
    });
    const posts = (await call<ReferencePost[]>('GET', '/reference/posts')).body;
    expect(posts.map((p) => p.externalId)).toEqual(['real-1']);
    expect((await call<unknown[]>('GET', '/content-pieces')).body).toEqual([]);
    expect((await call<Market[]>('GET', '/markets')).body).toHaveLength(2);
    expect((await call<unknown[]>('GET', '/reference/sources')).body).toHaveLength(1);
  });

  it('rodar de novo não apaga nada', async () => {
    const again = await call<DemoDataSummary>('DELETE', '/admin/demo-data');
    expect(again.body.posts).toBe(0);
    expect((await call<ReferencePost[]>('GET', '/reference/posts')).body).toHaveLength(1);
  });
});
