import { ContentPieceId, domainEvent, type ContentPieceApproved } from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPublicationRepository } from '../../infrastructure';
import { aPostingTarget, StubChannelDirectory } from '../../testing';
import { onContentPieceApproved } from '../event-handlers/on-content-piece-approved';
import { SchedulePublication } from './schedule-publication';

describe('SchedulePublication', () => {
  let publications: InMemoryPublicationRepository;
  let events: RecordingEventBus;
  let clock: FixedClock;
  let schedule: SchedulePublication;

  beforeEach(() => {
    publications = new InMemoryPublicationRepository();
    events = new RecordingEventBus();
    // 06:00 na Cidade do México.
    clock = new FixedClock('2026-10-15T12:00:00.000Z');
    schedule = new SchedulePublication(
      publications,
      new StubChannelDirectory([aPostingTarget({ channelId: 'ch-1', marketId: 'm-es' })]),
      new SequentialIdGenerator('pub'),
      clock,
      events,
    );
  });

  const approve = (contentPieceId: string, format: 'reel' | 'carousel' = 'reel') =>
    schedule.execute({ contentPieceId, channelId: 'ch-1', format });

  it('agenda no próximo horário da grade do formato, salva e publica o evento', async () => {
    const publication = await approve('cp-1');

    expect(publication.toSnapshot()).toMatchObject({
      id: 'pub-1',
      contentPieceId: 'cp-1',
      channelId: 'ch-1',
      marketId: 'm-es',
      format: 'reel',
      status: 'scheduled',
      attempts: 0,
      scheduledAt: '2026-10-15T16:00:00.000Z',
    });
    expect(await publications.findById(publication.id)).not.toBeNull();
    expect(events.published).toEqual([
      {
        type: 'publishing.publication_scheduled',
        occurredAt: '2026-10-15T12:00:00.000Z',
        payload: {
          publicationId: 'pub-1',
          contentPieceId: 'cp-1',
          scheduledAt: '2026-10-15T16:00:00.000Z',
        },
      },
    ]);
  });

  it('é idempotente: a mesma peça aprovada duas vezes gera uma publicação', async () => {
    const first = await approve('cp-1');
    const second = await approve('cp-1');

    expect(second.id).toBe(first.id);
    expect(await publications.list()).toHaveLength(1);
    expect(events.typesPublished()).toEqual(['publishing.publication_scheduled']);
  });

  it('peças seguintes ocupam os próximos horários livres do canal', async () => {
    const a = await approve('cp-1');
    const b = await approve('cp-2');
    const c = await approve('cp-3', 'carousel');

    expect([a, b, c].map((p) => p.scheduledAt.toISOString())).toEqual([
      '2026-10-15T16:00:00.000Z',
      '2026-10-16T02:00:00.000Z',
      '2026-10-15T20:00:00.000Z',
    ]);
  });

  it('publicação cancelada libera a peça e o horário', async () => {
    const first = await approve('cp-1');
    first.cancel();
    await publications.save(first);

    const again = await approve('cp-1');

    expect(again.id).not.toBe(first.id);
    expect(again.scheduledAt).toEqual(first.scheduledAt);
    expect((await publications.findActiveByContentPiece(ContentPieceId('cp-1')))?.id).toBe(
      again.id,
    );
  });

  it('canal inexistente → not_found, sem salvar nada', async () => {
    await expect(
      schedule.execute({ contentPieceId: 'cp-1', channelId: 'ch-x', format: 'reel' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await publications.list()).toEqual([]);
    expect(events.published).toEqual([]);
  });

  it('reage a studio.content_piece_approved', async () => {
    const event: ContentPieceApproved = domainEvent('studio.content_piece_approved', clock.now(), {
      contentPieceId: 'cp-9',
      marketId: 'm-es',
      channelId: 'ch-1',
      format: 'carousel',
      approvedBy: 'u-1',
    });

    await onContentPieceApproved(schedule)(event);

    const publication = await publications.findActiveByContentPiece(ContentPieceId('cp-9'));
    expect(publication?.format).toBe('carousel');
    expect(publication?.scheduledAt.toISOString()).toBe('2026-10-15T20:00:00.000Z');
  });
});
