import { ChannelId } from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPublicationRepository } from '../../infrastructure';
import { aPublication } from '../../testing';
import { CancelPublication } from './cancel-publication';
import { GetPublication } from './get-publication';
import { ListPublications } from './list-publications';
import { ReschedulePublication } from './reschedule-publication';

describe('gestão de publicações', () => {
  let publications: InMemoryPublicationRepository;
  let events: RecordingEventBus;
  let clock: FixedClock;

  beforeEach(async () => {
    publications = new InMemoryPublicationRepository();
    events = new RecordingEventBus();
    clock = new FixedClock('2026-10-15T12:00:00.000Z');
    await publications.save(aPublication({ id: 'pub-1' }));
  });

  describe('ReschedulePublication', () => {
    const reschedule = () => new ReschedulePublication(publications, clock, events);

    it('muda o horário, salva e publica publication_rescheduled', async () => {
      const at = new Date('2026-10-17T09:00:00.000Z');
      await reschedule().execute('pub-1', { scheduledAt: at });

      expect((await new GetPublication(publications).execute('pub-1')).scheduledAt).toEqual(at);
      expect(events.published).toEqual([
        {
          type: 'publishing.publication_rescheduled',
          occurredAt: '2026-10-15T12:00:00.000Z',
          payload: {
            publicationId: 'pub-1',
            contentPieceId: 'cp-1',
            scheduledAt: at.toISOString(),
          },
        },
      ]);
    });

    it('recusa horário no passado', async () => {
      await expect(
        reschedule().execute('pub-1', { scheduledAt: new Date('2026-10-15T11:00:00.000Z') }),
      ).rejects.toMatchObject({ code: 'scheduled_at_in_past' });
      expect(events.published).toEqual([]);
    });

    it('publicação inexistente → not_found', async () => {
      await expect(
        reschedule().execute('nope', { scheduledAt: new Date('2026-10-17T09:00:00.000Z') }),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('CancelPublication', () => {
    it('cancela e persiste', async () => {
      await new CancelPublication(publications, events).execute('pub-1');
      expect((await new GetPublication(publications).execute('pub-1')).status).toBe('cancelled');
    });

    it('não cancela duas vezes', async () => {
      const cancel = new CancelPublication(publications, events);
      await cancel.execute('pub-1');
      await expect(cancel.execute('pub-1')).rejects.toMatchObject({ code: 'invalid_transition' });
    });
  });

  describe('ListPublications', () => {
    beforeEach(async () => {
      await publications.save(
        aPublication({ id: 'pub-2', scheduledAt: new Date('2026-10-15T14:00:00.000Z') }),
      );
      await publications.save(
        aPublication({
          id: 'pub-3',
          channelId: ChannelId('ch-2'),
          scheduledAt: new Date('2026-10-16T14:00:00.000Z'),
        }),
      );
    });

    it('ordena pelo horário agendado', async () => {
      const list = await new ListPublications(publications).execute();
      expect(list.map((p) => p.id)).toEqual(['pub-2', 'pub-1', 'pub-3']);
    });

    it('filtra por intervalo (inclusivo) e por canal', async () => {
      const list = new ListPublications(publications);
      const inRange = await list.execute({
        from: new Date('2026-10-15T16:00:00.000Z'),
        to: new Date('2026-10-16T14:00:00.000Z'),
      });
      expect(inRange.map((p) => p.id)).toEqual(['pub-1', 'pub-3']);
      expect((await list.execute({ channelId: 'ch-1' })).map((p) => p.id)).toEqual([
        'pub-2',
        'pub-1',
      ]);
    });
  });

  it('GetPublication: inexistente → not_found', async () => {
    await expect(new GetPublication(publications).execute('nope')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
