import { ChannelId, ContentPieceId, PublicationId } from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Publication } from '../../domain';
import { FakeSocialPublisher, InMemoryPublicationRepository } from '../../infrastructure';
import {
  aPostingTarget,
  aPublication,
  aPublishableContent,
  StubChannelDirectory,
  StubPublishableContent,
} from '../../testing';
import { PublishDuePublications } from './publish-due-publications';

const DUE = '2026-10-15T16:00:00.000Z';
const SIMULATED = 'Instagram indisponível (falha simulada).';

describe('PublishDuePublications', () => {
  let publications: InMemoryPublicationRepository;
  let content: StubPublishableContent;
  let events: RecordingEventBus;
  let clock: FixedClock;

  beforeEach(() => {
    publications = new InMemoryPublicationRepository();
    content = new StubPublishableContent();
    events = new RecordingEventBus();
    clock = new FixedClock('2026-10-15T16:00:30.000Z');
  });

  const useCase = (publisher: FakeSocialPublisher) =>
    new PublishDuePublications(
      publications,
      new StubChannelDirectory([aPostingTarget({ channelId: 'ch-1', externalAccountId: 'ig-es' })]),
      content,
      publisher,
      clock,
      events,
    );

  async function given(id: string, scheduledAt = DUE): Promise<Publication> {
    const publication = aPublication({
      id,
      contentPieceId: ContentPieceId(`cp-${id}`),
      channelId: ChannelId('ch-1'),
      scheduledAt: new Date(scheduledAt),
    });
    content.set(`cp-${id}`);
    await publications.save(publication);
    return publication;
  }

  async function load(id: string): Promise<Publication> {
    const p = await publications.findById(PublicationId(id));
    if (!p) throw new Error(`publicação ${id} sumiu`);
    return p;
  }

  it('sem nada devido, não faz nada', async () => {
    await given('future', '2026-10-15T20:00:00.000Z');
    const publisher = new FakeSocialPublisher();

    expect(await useCase(publisher).execute()).toEqual({ published: 0, failed: 0, retried: 0 });
    expect(publisher.requests).toEqual([]);
    expect((await load('future')).status).toBe('scheduled');
  });

  it('publica as devidas e envia legenda, mídia e conta do canal', async () => {
    await given('a');
    const publisher = new FakeSocialPublisher();

    expect(await useCase(publisher).execute()).toEqual({ published: 1, failed: 0, retried: 0 });

    expect((await load('a')).toSnapshot()).toMatchObject({
      status: 'published',
      attempts: 1,
      externalMediaId: 'fake-1',
      permalink: 'https://www.instagram.com/p/SBS1/',
      publishedAt: '2026-10-15T16:00:30.000Z',
    });
    const expected = aPublishableContent();
    expect(publisher.requests).toEqual([
      {
        channelId: 'ch-1',
        channelExternalAccountId: 'ig-es',
        format: 'reel',
        assets: expected.assets,
        caption: expected.caption,
      },
    ]);
    expect(events.published).toEqual([
      {
        type: 'publishing.publication_published',
        occurredAt: '2026-10-15T16:00:30.000Z',
        payload: {
          publicationId: 'a',
          contentPieceId: 'cp-a',
          permalink: 'https://www.instagram.com/p/SBS1/',
          publishedAt: '2026-10-15T16:00:30.000Z',
        },
      },
    ]);
  });

  it('uma falha não impede as outras: a que falhou volta para a fila em +10 min', async () => {
    await given('a', '2026-10-15T15:00:00.000Z');
    await given('b', '2026-10-15T15:30:00.000Z');
    await given('c', DUE);
    await given('later', '2026-10-15T20:00:00.000Z');
    // A mais antiga (a) é processada primeiro e leva a falha.
    const publisher = new FakeSocialPublisher({ failTimes: 1 });

    expect(await useCase(publisher).execute()).toEqual({ published: 2, failed: 0, retried: 1 });

    expect((await load('a')).toSnapshot()).toMatchObject({
      status: 'scheduled',
      attempts: 1,
      scheduledAt: '2026-10-15T16:10:30.000Z',
      lastError: SIMULATED,
    });
    expect((await load('b')).permalink).toBe('https://www.instagram.com/p/SBS1/');
    expect((await load('c')).permalink).toBe('https://www.instagram.com/p/SBS2/');
    expect((await load('later')).status).toBe('scheduled');
    expect(events.typesPublished()).toEqual([
      'publishing.publication_published',
      'publishing.publication_published',
    ]);
  });

  it('a retentativa só roda no novo horário e pode dar certo', async () => {
    await given('a');
    const publish = useCase(new FakeSocialPublisher({ failTimes: 1 }));

    expect(await publish.execute()).toEqual({ published: 0, failed: 0, retried: 1 });
    clock.advanceMinutes(5);
    expect(await publish.execute()).toEqual({ published: 0, failed: 0, retried: 0 });
    clock.advanceMinutes(5);
    expect(await publish.execute()).toEqual({ published: 1, failed: 0, retried: 0 });

    const a = await load('a');
    expect(a.status).toBe('published');
    expect(a.attempts).toBe(2);
    expect(a.lastError).toBeNull();
  });

  it('esgota as 3 tentativas e marca failed com evento', async () => {
    await given('a');
    const publish = useCase(new FakeSocialPublisher({ alwaysFail: true }));

    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await publish.execute());
      clock.advanceMinutes(10);
    }

    expect(results).toEqual([
      { published: 0, failed: 0, retried: 1 },
      { published: 0, failed: 0, retried: 1 },
      { published: 0, failed: 1, retried: 0 },
    ]);
    expect((await load('a')).toSnapshot()).toMatchObject({ status: 'failed', attempts: 3 });
    expect(events.published).toEqual([
      {
        type: 'publishing.publication_failed',
        occurredAt: '2026-10-15T16:20:30.000Z',
        payload: { publicationId: 'a', contentPieceId: 'cp-a', error: SIMULATED, attempts: 3 },
      },
    ]);

    // Falhou de vez: não volta mais para a fila.
    clock.advanceMinutes(60);
    expect(await publish.execute()).toEqual({ published: 0, failed: 0, retried: 0 });
  });

  it('conteúdo indisponível conta como tentativa falha', async () => {
    await given('a');
    await publications.save(
      aPublication({
        id: 'orphan',
        contentPieceId: ContentPieceId('cp-missing'),
        scheduledAt: new Date(DUE),
      }),
    );

    expect(await useCase(new FakeSocialPublisher()).execute()).toEqual({
      published: 1,
      failed: 0,
      retried: 1,
    });
    expect((await load('orphan')).lastError).toBe('Não encontrado: Peça cp-missing.');
  });

  it('erro inesperado ao salvar não impede as outras e é relançado no fim', async () => {
    await given('a', '2026-10-15T15:00:00.000Z');
    await given('b');
    const save = publications.save.bind(publications);
    publications.save = async (p) => {
      if (p.id === 'a' && p.status === 'published') throw new Error('banco fora do ar');
      return save(p);
    };

    await expect(useCase(new FakeSocialPublisher()).execute()).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect((await load('b')).status).toBe('published');
  });
});
