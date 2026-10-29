import { ReferenceSourceId } from '@sbs/shared-kernel';
import { FixedClock, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReferenceSource } from '../../domain';
import {
  FakeReferenceFeed,
  InMemoryReferencePostRepository,
  InMemoryReferenceSourceRepository,
} from '../../infrastructure';
import { aFeedPost, aPostMetrics } from '../../testing';
import type { FeedPost, ReferenceFeed } from '../ports/reference-feed';
import { SyncReferenceFeed } from './sync-reference-feed';

/** Feed controlado pelo teste: devolve o que estiver em `items`. */
class StubFeed implements ReferenceFeed {
  items: FeedPost[] = [];
  requests: { source: { id: string; handle: string }; now: Date }[] = [];

  async fetchRecent(source: { id: string; handle: string }, now: Date): Promise<FeedPost[]> {
    this.requests.push({ source, now });
    return this.items.map((i) => ({ ...i, metrics: { ...i.metrics } }));
  }
}

describe('SyncReferenceFeed', () => {
  let sources: InMemoryReferenceSourceRepository;
  let posts: InMemoryReferencePostRepository;
  let clock: FixedClock;
  let feed: StubFeed;
  let sync: SyncReferenceFeed;

  beforeEach(async () => {
    sources = new InMemoryReferenceSourceRepository();
    posts = new InMemoryReferencePostRepository();
    clock = new FixedClock('2026-10-15T12:00:00.000Z');
    feed = new StubFeed();
    sync = new SyncReferenceFeed(sources, posts, feed, new SequentialIdGenerator('post'), clock);
    await sources.save(
      ReferenceSource.create(ReferenceSourceId('src-1'), { handle: 'saobento.oficial' }),
    );
  });

  it('importa posts novos, pede o feed com a conta e o relógio e marca a sincronização', async () => {
    feed.items = [
      aFeedPost({ externalId: 'a' }),
      aFeedPost({ externalId: 'b', format: 'carousel' }),
    ];

    const result = await sync.execute({ sourceId: 'src-1' });

    expect(result).toEqual({ imported: 2, updated: 0 });
    expect(feed.requests).toEqual([
      { source: { id: 'src-1', handle: 'saobento.oficial' }, now: clock.now() },
    ]);
    const stored = await posts.listBySource(ReferenceSourceId('src-1'));
    expect(stored.map((p) => [p.externalId, p.status, p.sourceId])).toEqual([
      ['a', 'new', 'src-1'],
      ['b', 'new', 'src-1'],
    ]);
    expect((await sources.findById(ReferenceSourceId('src-1')))?.lastSyncedAt).toEqual(clock.now());
  });

  it('é idempotente: rodar de novo sem mudanças não cria nem altera posts', async () => {
    feed.items = [aFeedPost({ externalId: 'a' }), aFeedPost({ externalId: 'b' })];
    await sync.execute({ sourceId: 'src-1' });
    const versionsBefore = (await posts.list()).map((p) => p.version);

    clock.advanceMinutes(60);
    const result = await sync.execute({ sourceId: 'src-1' });

    expect(result).toEqual({ imported: 0, updated: 0 });
    expect(await posts.list()).toHaveLength(2);
    expect((await posts.list()).map((p) => p.version)).toEqual(versionsBefore);
    expect((await sources.findById(ReferenceSourceId('src-1')))?.lastSyncedAt).toEqual(clock.now());
  });

  it('atualiza as métricas dos posts existentes sem mudar o status', async () => {
    feed.items = [aFeedPost({ externalId: 'a', metrics: aPostMetrics({ likes: 100 }) })];
    await sync.execute({ sourceId: 'src-1' });
    const [post] = await posts.list();
    post!.select(clock.now());
    await posts.save(post!);

    feed.items = [
      aFeedPost({ externalId: 'a', metrics: aPostMetrics({ likes: 250 }) }),
      aFeedPost({ externalId: 'c' }),
    ];
    const result = await sync.execute({ sourceId: 'src-1' });

    expect(result).toEqual({ imported: 1, updated: 1 });
    const updated = await posts.findBySourceAndExternalId(ReferenceSourceId('src-1'), 'a');
    expect(updated?.metrics.likes).toBe(250);
    expect(updated?.status).toBe('selected');
  });

  it('atualiza legenda e mídia (as URLs do CDN do Instagram expiram)', async () => {
    feed.items = [aFeedPost({ externalId: 'a' })];
    await sync.execute({ sourceId: 'src-1' });

    feed.items = [
      aFeedPost({
        externalId: 'a',
        caption: 'Legenda editada no Instagram',
        thumbnailUrl: 'https://scontent.cdninstagram.com/nova-capa.jpg',
        mediaUrls: ['https://scontent.cdninstagram.com/novo.mp4'],
      }),
    ];
    const result = await sync.execute({ sourceId: 'src-1' });

    expect(result).toEqual({ imported: 0, updated: 1 });
    const post = await posts.findBySourceAndExternalId(ReferenceSourceId('src-1'), 'a');
    expect(post?.caption).toBe('Legenda editada no Instagram');
    expect(post?.thumbnailUrl).toBe('https://scontent.cdninstagram.com/nova-capa.jpg');
    expect(post?.mediaUrls).toEqual(['https://scontent.cdninstagram.com/novo.mp4']);
    expect(post?.toSnapshot().caption).toBe('Legenda editada no Instagram');
  });

  it('o mesmo id externo em outra conta é outro post', async () => {
    await sources.save(
      ReferenceSource.create(ReferenceSourceId('src-2'), { handle: 'outra_conta' }),
    );
    feed.items = [aFeedPost({ externalId: 'a' })];

    await sync.execute({ sourceId: 'src-1' });
    const result = await sync.execute({ sourceId: 'src-2' });

    expect(result).toEqual({ imported: 1, updated: 0 });
    expect(await posts.list()).toHaveLength(2);
  });

  it('não lê página desconectada (nem chama o feed)', async () => {
    const source = (await sources.findById(ReferenceSourceId('src-1')))!;
    source.disconnect();
    await sources.save(source);
    feed.items = [aFeedPost({ externalId: 'a' })];

    await expect(sync.execute({ sourceId: 'src-1' })).rejects.toMatchObject({
      code: 'reference_source_disconnected',
    });
    expect(feed.requests).toEqual([]);
    expect(await posts.list()).toEqual([]);
  });

  it('falha para conta de referência inexistente', async () => {
    await expect(sync.execute({ sourceId: 'nao-existe' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('com o FakeReferenceFeed: 12 posts na primeira vez, só atualizações depois', async () => {
    const fakeSync = new SyncReferenceFeed(
      sources,
      posts,
      new FakeReferenceFeed(),
      new SequentialIdGenerator('post'),
      clock,
    );

    expect(await fakeSync.execute({ sourceId: 'src-1' })).toEqual({ imported: 12, updated: 0 });
    expect(await fakeSync.execute({ sourceId: 'src-1' })).toEqual({ imported: 0, updated: 12 });
  });
});
