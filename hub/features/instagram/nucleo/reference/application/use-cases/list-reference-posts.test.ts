import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryReferencePostRepository } from '../../infrastructure';
import { aReferencePost } from '../../testing';
import { ListReferencePosts } from './list-reference-posts';

describe('ListReferencePosts', () => {
  let posts: InMemoryReferencePostRepository;
  let list: ListReferencePosts;

  const withScore = (id: string, score: number, publishedAt = '2026-10-10T12:00:00.000Z') =>
    aReferencePost({
      id,
      externalId: `ext-${id}`,
      publishedAt: new Date(publishedAt),
      metrics: { views: 1000, reach: 0, likes: score, comments: 0, saves: 0, shares: 0 },
    });

  beforeEach(async () => {
    posts = new InMemoryReferencePostRepository();
    list = new ListReferencePosts(posts);

    await posts.save(withScore('low', 10));
    await posts.save(withScore('high', 90));
    await posts.save(withScore('tie-old', 50, '2026-10-01T12:00:00.000Z'));
    await posts.save(withScore('tie-new', 50, '2026-10-12T12:00:00.000Z'));
    const ignored = withScore('ignored', 70);
    ignored.ignore();
    await posts.save(ignored);
  });

  it('lista todos do maior para o menor score; empate, o mais recente primeiro', async () => {
    expect((await list.execute()).map((p) => p.id)).toEqual([
      'high',
      'ignored',
      'tie-new',
      'tie-old',
      'low',
    ]);
  });

  it('filtra por status', async () => {
    expect((await list.execute({ status: 'ignored' })).map((p) => p.id)).toEqual(['ignored']);
    expect((await list.execute({ status: 'new' })).map((p) => p.id)).toEqual([
      'high',
      'tie-new',
      'tie-old',
      'low',
    ]);
    expect(await list.execute({ status: 'selected' })).toEqual([]);
  });
});
