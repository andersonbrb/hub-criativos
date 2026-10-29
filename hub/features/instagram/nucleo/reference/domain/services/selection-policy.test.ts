import type { ContentFormat } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { aReferencePost } from '../../testing/builders';
import type { ReferencePost } from '../reference-post/reference-post';
import { DEFAULT_SELECTION_POLICY, SelectionPolicy } from './selection-policy';

const now = new Date('2026-10-15T12:00:00.000Z');
const HOUR = 3_600_000;

/** Post cujo score é exatamente `score` (só curtidas, 1000 visualizações). */
function post(
  id: string,
  score: number,
  hoursAgo = 48,
  opts: { format?: ContentFormat; status?: 'new' | 'selected' | 'ignored' } = {},
): ReferencePost {
  const p = aReferencePost({
    id,
    externalId: `ext-${id}`,
    format: opts.format ?? 'reel',
    publishedAt: new Date(now.getTime() - hoursAgo * HOUR),
    metrics: { views: 1000, reach: 0, likes: score, comments: 0, saves: 0, shares: 0 },
  });
  if (opts.status === 'selected') p.select(now);
  if (opts.status === 'ignored') p.ignore();
  return p;
}

const ids = (posts: ReferencePost[]) => posts.map((p) => p.id);

describe('SelectionPolicy', () => {
  it('usa os padrões da especificação', () => {
    expect(new SelectionPolicy().config).toEqual({
      topPercent: 20,
      minAgeHours: 24,
      maxPerRun: 3,
      maxAgeDays: 30,
    });
    expect(DEFAULT_SELECTION_POLICY).toEqual(new SelectionPolicy().config);
  });

  it('sem posts, não há vencedores', () => {
    expect(new SelectionPolicy().pickWinners([], now)).toEqual([]);
  });

  it('devolve os novos do top N%, ordenados por score', () => {
    const posts = Array.from({ length: 10 }, (_, i) => post(`p${i}`, (i + 1) * 10));
    // 10 posts × 20% = 2
    expect(ids(new SelectionPolicy().pickWinners(posts, now))).toEqual(['p9', 'p8']);
  });

  it('arredonda o corte para cima, para janelas pequenas terem vencedor', () => {
    const posts = [post('a', 10), post('b', 30), post('c', 20)];
    expect(ids(new SelectionPolicy().pickWinners(posts, now))).toEqual(['b']);
  });

  describe('janela de idade', () => {
    it('exclui posts mais novos que minAgeHours (métricas não assentadas)', () => {
      const posts = [post('fresh', 999, 23), post('settled', 10, 24)];
      expect(ids(new SelectionPolicy({ topPercent: 100 }).pickWinners(posts, now))).toEqual([
        'settled',
      ]);
    });

    it('exclui posts mais velhos que maxAgeDays', () => {
      const posts = [post('old', 999, 30 * 24 + 1), post('limit', 10, 30 * 24)];
      expect(ids(new SelectionPolicy({ topPercent: 100 }).pickWinners(posts, now))).toEqual([
        'limit',
      ]);
    });

    it('posts fora da janela não contam para o corte do percentil', () => {
      // Se o post fresco entrasse no ranking, ocuparia a única vaga do top 20%.
      const posts = [
        post('fresh', 999, 1),
        ...Array.from({ length: 5 }, (_, i) => post(`p${i}`, i + 1)),
      ];
      expect(ids(new SelectionPolicy().pickWinners(posts, now))).toEqual(['p4']);
    });
  });

  it('exclui formatos não adaptáveis, mesmo com score alto, e eles não contam para o corte', () => {
    const posts = [
      post('img', 999, 48, { format: 'image' }),
      post('story', 998, 48, { format: 'story' }),
      post('r1', 10),
      post('r2', 20),
      post('r3', 30),
      post('r4', 40),
      post('r5', 50),
    ];
    expect(ids(new SelectionPolicy().pickWinners(posts, now))).toEqual(['r5']);
  });

  describe('corte do percentil inclui posts já selecionados', () => {
    it('se o topo já foi selecionado, não sobra vencedor', () => {
      const posts = [
        post('top1', 100, 48, { status: 'selected' }),
        post('top2', 90, 48, { status: 'selected' }),
        ...Array.from({ length: 8 }, (_, i) => post(`p${i}`, i + 1)),
      ];
      expect(new SelectionPolicy().pickWinners(posts, now)).toEqual([]);
    });

    it('devolve só os novos dentro do topo', () => {
      const posts = [
        post('top1', 100, 48, { status: 'selected' }),
        post('top2', 90),
        ...Array.from({ length: 8 }, (_, i) => post(`p${i}`, i + 1)),
      ];
      expect(ids(new SelectionPolicy().pickWinners(posts, now))).toEqual(['top2']);
    });

    it('posts ignorados também ocupam lugar no ranking, mas nunca são devolvidos', () => {
      const posts = [
        post('ignored', 100, 48, { status: 'ignored' }),
        ...Array.from({ length: 4 }, (_, i) => post(`p${i}`, i + 1)),
      ];
      expect(new SelectionPolicy().pickWinners(posts, now)).toEqual([]);
    });
  });

  it('limita a maxPerRun', () => {
    const posts = Array.from({ length: 20 }, (_, i) => post(`p${i}`, i + 1));
    const winners = new SelectionPolicy({ topPercent: 50, maxPerRun: 3 }).pickWinners(posts, now);
    expect(ids(winners)).toEqual(['p19', 'p18', 'p17']);
  });

  it('em empate de score, o mais recente vem primeiro', () => {
    const posts = [
      post('older', 50, 72),
      post('newer', 50, 30),
      post('low', 1),
      post('low2', 2),
      post('low3', 3),
    ];
    // 5 × 20% = 1 vaga: o empate é decidido pela data de publicação.
    expect(ids(new SelectionPolicy().pickWinners(posts, now))).toEqual(['newer']);
    expect(ids(new SelectionPolicy({ topPercent: 40 }).pickWinners(posts, now))).toEqual([
      'newer',
      'older',
    ]);
  });

  it.each([
    ['topPercent zero', { topPercent: 0 }],
    ['topPercent acima de 100', { topPercent: 101 }],
    ['minAgeHours negativo', { minAgeHours: -1 }],
    ['maxAgeDays menor que minAgeHours', { minAgeHours: 48, maxAgeDays: 1 }],
    ['maxPerRun zero', { maxPerRun: 0 }],
    ['maxPerRun fracionário', { maxPerRun: 1.5 }],
  ])('rejeita configuração com %s', (_label, config) => {
    expect(() => new SelectionPolicy(config)).toThrow(
      expect.objectContaining({ code: 'invalid_selection_policy' }),
    );
  });
});
