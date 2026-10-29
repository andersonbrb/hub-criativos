import { DomainError, type ReferencePostSelected } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { aPostMetrics, aReferencePost } from '../../testing/builders';
import { ReferencePost } from './reference-post';

const now = new Date('2026-10-15T12:00:00.000Z');

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('ReferencePost', () => {
  it('nasce novo, sem seleção, sem adaptações e sem eventos', () => {
    const post = aReferencePost();

    expect(post.status).toBe('new');
    expect(post.selectedAt).toBeNull();
    expect(post.adaptationsCount).toBe(0);
    expect(post.pullEvents()).toEqual([]);
  });

  it('limpa o id externo e rejeita id vazio', () => {
    expect(aReferencePost({ externalId: '  178  ' }).externalId).toBe('178');
    expect(errorCode(() => aReferencePost({ externalId: '   ' }))).toBe('invalid_external_id');
  });

  it('rejeita formato desconhecido e métricas negativas', () => {
    expect(errorCode(() => aReferencePost({ format: 'live' as never }))).toBe(
      'invalid_content_format',
    );
    expect(errorCode(() => aReferencePost({ metrics: aPostMetrics({ comments: -3 }) }))).toBe(
      'invalid_post_metrics',
    );
  });

  it('não compartilha a lista de mídias com quem criou', () => {
    const mediaUrls = ['https://picsum.photos/seed/a/1080/1350'];
    const post = aReferencePost({ format: 'carousel', mediaUrls });
    mediaUrls.push('https://picsum.photos/seed/b/1080/1350');
    expect(post.mediaUrls).toHaveLength(1);
  });

  it('calcula o performanceScore a partir das métricas atuais', () => {
    const post = aReferencePost({
      metrics: { views: 2000, reach: 1500, likes: 100, comments: 10, saves: 20, shares: 5 },
    });
    // (100 + 20 + 60 + 20) / 2000 × 1000
    expect(post.performanceScore).toBe(100);
  });

  describe('updateMetrics', () => {
    it('substitui as métricas inteiras, inclusive para valores menores', () => {
      const post = aReferencePost();
      post.updateMetrics(
        aPostMetrics({ likes: 1, views: 1000, reach: 0, comments: 0, saves: 0, shares: 0 }),
      );
      expect(post.metrics.likes).toBe(1);
      expect(post.performanceScore).toBe(1);
    });

    it('rejeita métricas negativas e mantém as anteriores', () => {
      const post = aReferencePost();
      const before = post.metrics;
      expect(errorCode(() => post.updateMetrics(aPostMetrics({ shares: -1 })))).toBe(
        'invalid_post_metrics',
      );
      expect(post.metrics).toBe(before);
    });

    it('funciona em qualquer status', () => {
      const post = aReferencePost();
      post.select(now);
      post.updateMetrics(aPostMetrics({ likes: 999 }));
      expect(post.metrics.likes).toBe(999);
    });
  });

  describe('select', () => {
    it('seleciona um post novo e emite reference.post_selected com o contrato publicado', () => {
      const post = aReferencePost({
        format: 'carousel',
        mediaUrls: ['https://picsum.photos/seed/s1/1080/1350'],
      });
      post.select(now);

      expect(post.status).toBe('selected');
      expect(post.selectedAt).toEqual(now);
      const expected: ReferencePostSelected = {
        type: 'reference.post_selected',
        occurredAt: now.toISOString(),
        payload: {
          referencePostId: 'post-1',
          format: 'carousel',
          caption: post.caption,
          permalink: post.permalink,
          thumbnailUrl: post.thumbnailUrl,
          mediaUrls: ['https://picsum.photos/seed/s1/1080/1350'],
        },
      };
      expect(post.pullEvents()).toEqual([expected]);
    });

    it('seleciona de novo (nova rodada) e publica o evento outra vez', () => {
      const post = aReferencePost();
      post.select(now);
      post.pullEvents();
      const later = new Date(now.getTime() + 3_600_000);

      post.select(later);

      expect(post.status).toBe('selected');
      expect(post.selectedAt).toEqual(later);
      expect(post.pullEvents().map((e) => e.type)).toEqual(['reference.post_selected']);
    });

    it('seleciona post ignorado (a equipe mudou de ideia)', () => {
      const post = aReferencePost();
      post.ignore();
      post.select(now);
      expect(post.status).toBe('selected');
    });

    it.each(['image', 'story'] as const)('não seleciona formato não adaptável (%s)', (format) => {
      const post = aReferencePost({ format });
      expect(errorCode(() => post.select(now))).toBe('format_not_adaptable');
      expect(post.status).toBe('new');
      expect(post.pullEvents()).toEqual([]);
    });
  });

  describe('ignore', () => {
    it('ignora um post novo', () => {
      const post = aReferencePost();
      post.ignore();
      expect(post.status).toBe('ignored');
    });

    it('é idempotente para post já ignorado', () => {
      const post = aReferencePost();
      post.ignore();
      post.ignore();
      expect(post.status).toBe('ignored');
    });

    it('não ignora post selecionado', () => {
      const post = aReferencePost();
      post.select(now);
      expect(errorCode(() => post.ignore())).toBe('post_already_selected');
      expect(post.status).toBe('selected');
    });
  });

  it('registerAdaptation incrementa o contador', () => {
    const post = aReferencePost();
    post.select(now);
    post.registerAdaptation();
    post.registerAdaptation();
    expect(post.adaptationsCount).toBe(2);
  });

  it('sobrevive a ida e volta pelo snapshot', () => {
    const post = aReferencePost({ format: 'carousel' });
    post.select(now);
    post.registerAdaptation();
    const copy = ReferencePost.fromSnapshot(post.toSnapshot());

    expect(copy.toSnapshot()).toEqual(post.toSnapshot());
    expect(copy.selectedAt).toEqual(now);
    expect(copy.performanceScore).toBe(post.performanceScore);
  });
});
