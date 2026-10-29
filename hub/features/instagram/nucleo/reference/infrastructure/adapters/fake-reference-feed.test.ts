import { isAdaptable } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { PostMetrics, SelectionPolicy } from '../../domain';
import { aReferencePost } from '../../testing';
import { FakeReferenceFeed } from './fake-reference-feed';

const source = { id: 'src-1', handle: 'saobento.oficial' };
const now = new Date('2026-10-15T12:00:00.000Z');
const DAY = 86_400_000;

function isHttps(url: string): boolean {
  return new URL(url).protocol === 'https:';
}

describe('FakeReferenceFeed', () => {
  it('entrega 12 posts com ids externos únicos, majoritariamente reels e carrosséis', async () => {
    const items = await new FakeReferenceFeed().fetchRecent(source, now);

    expect(items).toHaveLength(12);
    expect(new Set(items.map((i) => i.externalId)).size).toBe(12);
    const images = items.filter((i) => i.format === 'image').length;
    expect(images).toBeGreaterThanOrEqual(1);
    expect(images).toBeLessThanOrEqual(2);
    expect(items.every((i) => i.format === 'image' || isAdaptable(i.format))).toBe(true);
  });

  it('usa URLs https válidas e a mídia certa para cada formato', async () => {
    const items = await new FakeReferenceFeed().fetchRecent(source, now);

    for (const item of items) {
      expect(item.permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\/[A-Za-z0-9_-]+\/$/);
      expect(item.thumbnailUrl).toMatch(/^https:\/\/picsum\.photos\/seed\/[^/]+\/1080\/1350$/);
      expect(item.mediaUrls.every(isHttps)).toBe(true);
      if (item.format === 'reel') {
        expect(item.mediaUrls).toHaveLength(1);
        expect(item.mediaUrls[0]).toMatch(
          /^https:\/\/storage\.googleapis\.com\/gtv-videos-bucket\/sample\/\w+\.mp4$/,
        );
      }
      if (item.format === 'carousel') {
        expect(item.mediaUrls.length).toBeGreaterThanOrEqual(3);
        expect(item.mediaUrls.length).toBeLessThanOrEqual(7);
        expect(item.mediaUrls.every((u) => u.startsWith('https://picsum.photos/seed/'))).toBe(true);
      }
      expect(() => PostMetrics.of(item.metrics)).not.toThrow();
    }
  });

  it('espalha as datas de publicação pelos últimos ~20 dias antes de `now`', async () => {
    const items = await new FakeReferenceFeed().fetchRecent(source, now);
    const ages = items.map((i) => now.getTime() - i.publishedAt.getTime());

    expect(Math.min(...ages)).toBeGreaterThan(0);
    expect(Math.max(...ages)).toBeLessThanOrEqual(20 * DAY);
    expect(Math.max(...ages)).toBeGreaterThan(15 * DAY);
  });

  it('é determinístico: mesmos ids e datas, métricas crescendo a cada leitura', async () => {
    const feed = new FakeReferenceFeed();
    const first = await feed.fetchRecent(source, now);
    const second = await feed.fetchRecent(source, new Date(now.getTime() + DAY));

    expect(second.map((i) => i.externalId)).toEqual(first.map((i) => i.externalId));
    expect(second.map((i) => i.publishedAt)).toEqual(first.map((i) => i.publishedAt));
    second.forEach((item, idx) => {
      expect(item.metrics.views).toBeGreaterThan(first[idx]!.metrics.views);
    });
    expect(await new FakeReferenceFeed().fetchRecent(source, now)).toEqual(first);
  });

  it('gera um ranking com vencedores claros para a política padrão', async () => {
    const items = await new FakeReferenceFeed().fetchRecent(source, now);
    const posts = items.map((item, i) => aReferencePost({ ...item, id: `p${i}` }));

    const winners = new SelectionPolicy().pickWinners(posts, now);

    expect(winners.length).toBeGreaterThanOrEqual(1);
    expect(winners.every((w) => w.isAdaptable)).toBe(true);
    const scores = new Set(posts.map((p) => p.performanceScore));
    expect(scores.size).toBe(posts.length);
  });
});
