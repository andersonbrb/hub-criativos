import { ReferencePostId, type ReferencePostSelected } from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryReferencePostRepository } from '../../infrastructure';
import { aReferencePost } from '../../testing';
import type { AdaptationTracker } from '../ports/adaptation-tracker';
import { SelectReferencePost } from './select-reference-post';

/** Adaptações em andamento por post, controladas pelo teste. */
class StubTracker implements AdaptationTracker {
  open = new Map<string, number>();
  async countOpen(referencePostId: string): Promise<number> {
    return this.open.get(referencePostId) ?? 0;
  }
}

describe('SelectReferencePost', () => {
  let posts: InMemoryReferencePostRepository;
  let clock: FixedClock;
  let events: RecordingEventBus;
  let select: SelectReferencePost;
  let tracker: StubTracker;

  beforeEach(() => {
    posts = new InMemoryReferencePostRepository();
    clock = new FixedClock('2026-10-15T12:00:00.000Z');
    events = new RecordingEventBus();
    tracker = new StubTracker();
    select = new SelectReferencePost(posts, clock, events, tracker);
  });

  it('seleciona manualmente, salva e publica reference.post_selected', async () => {
    // Recém-publicado: a política automática não pegaria, mas a escolha manual pode.
    await posts.save(aReferencePost({ id: 'p1', publishedAt: clock.now() }));

    const post = await select.execute('p1');

    expect(post.status).toBe('selected');
    expect((await posts.findById(ReferencePostId('p1')))?.selectedAt).toEqual(clock.now());
    expect(events.typesPublished()).toEqual(['reference.post_selected']);
    expect((events.published[0] as ReferencePostSelected).payload.referencePostId).toBe('p1');
  });

  it('não publica nada quando a seleção é inválida', async () => {
    await posts.save(aReferencePost({ id: 'img', format: 'image' }));

    await expect(select.execute('img')).rejects.toMatchObject({ code: 'format_not_adaptable' });
    expect(events.published).toEqual([]);
    expect((await posts.findById(ReferencePostId('img')))?.status).toBe('new');
  });

  it('não seleciona de novo enquanto há adaptação em andamento', async () => {
    await posts.save(aReferencePost({ id: 'p1' }));
    await select.execute('p1');
    tracker.open.set('p1', 2);

    await expect(select.execute('p1')).rejects.toMatchObject({
      code: 'adaptations_in_progress',
      details: { count: 2 },
    });
    expect(events.published).toHaveLength(1);
  });

  it('seleciona de novo quando as adaptações foram reprovadas ou publicadas', async () => {
    await posts.save(aReferencePost({ id: 'p1' }));
    await select.execute('p1');
    tracker.open.set('p1', 0);

    const post = await select.execute('p1');

    expect(post.status).toBe('selected');
    expect(events.typesPublished()).toEqual(['reference.post_selected', 'reference.post_selected']);
  });

  it('seleciona um post que tinha sido ignorado', async () => {
    const ignored = aReferencePost({ id: 'p2' });
    ignored.ignore();
    await posts.save(ignored);

    expect((await select.execute('p2')).status).toBe('selected');
  });

  it('falha para post inexistente', async () => {
    await expect(select.execute('x')).rejects.toMatchObject({ code: 'not_found' });
  });
});
