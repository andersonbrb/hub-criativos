import { DomainError } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { aPostMetrics } from '../../testing/builders';
import { PostMetrics } from './post-metrics';

const zero = { views: 0, reach: 0, likes: 0, comments: 0, saves: 0, shares: 0 };

describe('PostMetrics', () => {
  it('com alcance: (likes + 2·comments + 3·saves + 4·shares) / max(reach, views) × 1000', () => {
    const metrics = PostMetrics.of({
      ...zero,
      views: 1000,
      reach: 800,
      likes: 10,
      comments: 5,
      saves: 2,
      shares: 1,
    });
    // 10 + 10 + 6 + 4 = 30 → 30 / 1000 × 1000
    expect(metrics.performanceScore).toBe(30);
  });

  it('usa o alcance quando ele é maior que as visualizações', () => {
    const metrics = PostMetrics.of({ ...zero, views: 500, reach: 2000, likes: 100 });
    expect(metrics.performanceScore).toBe(50);
  });

  it('sem alcance (dados públicos do perfil), usa o engajamento absoluto', () => {
    // 2 + 2·3 = 8: as visualizações dos reels não entram, para fotos e carrosséis
    // (que não mostram visualizações) ficarem na mesma escala.
    expect(PostMetrics.of({ ...zero, views: 5000, likes: 2, comments: 3 }).performanceScore).toBe(
      8,
    );
    expect(PostMetrics.of({ ...zero, likes: 2, comments: 3 }).performanceScore).toBe(8);
    expect(PostMetrics.zero().performanceScore).toBe(0);
  });

  it('arredonda a 2 casas decimais', () => {
    expect(PostMetrics.of({ ...zero, reach: 3, likes: 1 }).performanceScore).toBe(333.33);
    expect(PostMetrics.of({ ...zero, reach: 3, likes: 2 }).performanceScore).toBe(666.67);
  });

  it.each([
    ['negativa', { likes: -1 }],
    ['fracionária', { saves: 1.5 }],
    ['não numérica', { views: Number.NaN }],
    ['infinita', { reach: Number.POSITIVE_INFINITY }],
  ])('rejeita métrica %s', (_label, overrides) => {
    expect(() => PostMetrics.of(aPostMetrics(overrides))).toThrow(
      expect.objectContaining({ code: 'invalid_post_metrics' }),
    );
    expect(() => PostMetrics.of(aPostMetrics(overrides))).toThrow(DomainError);
  });

  it('compara por valor e devolve as propriedades', () => {
    const props = aPostMetrics();
    expect(PostMetrics.of(props).equals(PostMetrics.of({ ...props }))).toBe(true);
    expect(
      PostMetrics.of(props).equals(PostMetrics.of({ ...props, shares: props.shares + 1 })),
    ).toBe(false);
    expect(PostMetrics.of(props).toProps()).toEqual(props);
  });
});
