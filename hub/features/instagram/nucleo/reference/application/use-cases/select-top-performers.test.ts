import {
  ReferenceSourceId,
  type ContentFormat,
  type ReferencePostSelected,
} from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryReferencePostRepository } from '../../infrastructure';
import { aReferencePost } from '../../testing';
import { SelectTopPerformers } from './select-top-performers';

const HOUR = 3_600_000;

describe('SelectTopPerformers', () => {
  let posts: InMemoryReferencePostRepository;
  let clock: FixedClock;
  let events: RecordingEventBus;

  async function seed(
    id: string,
    score: number,
    opts: { hoursAgo?: number; format?: ContentFormat; sourceId?: string } = {},
  ) {
    await posts.save(
      aReferencePost({
        id,
        externalId: `ext-${id}`,
        sourceId: ReferenceSourceId(opts.sourceId ?? 'src-1'),
        format: opts.format ?? 'reel',
        publishedAt: new Date(clock.now().getTime() - (opts.hoursAgo ?? 48) * HOUR),
        metrics: { views: 1000, reach: 0, likes: score, comments: 0, saves: 0, shares: 0 },
      }),
    );
  }

  beforeEach(() => {
    posts = new InMemoryReferencePostRepository();
    clock = new FixedClock('2026-10-15T12:00:00.000Z');
    events = new RecordingEventBus();
  });

  it('seleciona os vencedores com a política padrão, salva e publica um evento por post', async () => {
    for (let i = 1; i <= 10; i++) await seed(`p${i}`, i * 10);

    const selected = await new SelectTopPerformers(posts, clock, events).execute();

    expect(selected.map((p) => p.id)).toEqual(['p10', 'p9']);
    expect((await posts.list({ status: 'selected' })).map((p) => p.id).sort()).toEqual([
      'p10',
      'p9',
    ]);
    expect(events.typesPublished()).toEqual(['reference.post_selected', 'reference.post_selected']);
    const first = events.published[0] as ReferencePostSelected;
    expect(first.payload.referencePostId).toBe('p10');
    expect(first.occurredAt).toBe(clock.now().toISOString());
  });

  it('aceita configuração da política injetada', async () => {
    for (let i = 1; i <= 10; i++) await seed(`p${i}`, i * 10);

    const selected = await new SelectTopPerformers(posts, clock, events, {
      topPercent: 100,
      maxPerRun: 5,
    }).execute();

    expect(selected.map((p) => p.id)).toEqual(['p10', 'p9', 'p8', 'p7', 'p6']);
  });

  it('rodar de novo não seleciona os mesmos posts nem passa do topo', async () => {
    for (let i = 1; i <= 10; i++) await seed(`p${i}`, i * 10);
    const useCase = new SelectTopPerformers(posts, clock, events);
    await useCase.execute();

    const again = await useCase.execute();

    expect(again).toEqual([]);
    expect(events.published).toHaveLength(2);
  });

  it('ignora posts recentes demais e formatos não adaptáveis', async () => {
    await seed('fresh', 999, { hoursAgo: 2 });
    await seed('image', 998, { format: 'image' });
    await seed('ok', 10);

    const selected = await new SelectTopPerformers(posts, clock, events).execute();

    expect(selected.map((p) => p.id)).toEqual(['ok']);
  });

  it('pode restringir o ranking a uma conta de referência', async () => {
    await seed('a', 10, { sourceId: 'src-1' });
    await seed('b', 999, { sourceId: 'src-2' });

    const selected = await new SelectTopPerformers(posts, clock, events).execute({
      sourceId: 'src-1',
    });

    expect(selected.map((p) => p.id)).toEqual(['a']);
  });

  it('rejeita configuração inválida ao montar o caso de uso', () => {
    expect(() => new SelectTopPerformers(posts, clock, events, { maxPerRun: 0 })).toThrow(
      expect.objectContaining({ code: 'invalid_selection_policy' }),
    );
  });
});
