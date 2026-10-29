import { DomainError, PublicationId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { aPublication, aScheduleProps } from '../../testing/builders';
import { Publication } from './publication';

const now = new Date('2026-10-15T12:00:00.000Z');
const dueAt = new Date('2026-10-15T16:00:00.000Z');
const afterDue = new Date('2026-10-15T16:01:00.000Z');
const minutesAfter = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

function errorOf(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error('esperava DomainError');
}

/** Leva a publicação até `failed`, esgotando as 3 tentativas. */
function exhausted(): Publication {
  const p = aPublication();
  let at = afterDue;
  for (let i = 0; i < 3; i += 1) {
    p.startPublishing(at);
    const retryAt = minutesAfter(at, 10);
    p.markAttemptFailed('timeout', at, retryAt);
    at = retryAt;
  }
  return p;
}

function publishing(): Publication {
  const p = aPublication();
  p.startPublishing(afterDue);
  return p;
}

function published(): Publication {
  const p = publishing();
  p.markPublished(
    { externalMediaId: 'm-1', permalink: 'https://www.instagram.com/p/X/' },
    afterDue,
  );
  p.pullEvents();
  return p;
}

function cancelled(): Publication {
  const p = aPublication();
  p.cancel();
  return p;
}

describe('Publication', () => {
  describe('schedule', () => {
    it('nasce agendada, sem tentativas, e emite publication_scheduled', () => {
      const p = Publication.schedule(PublicationId('pub-1'), aScheduleProps(), now);

      expect(p.status).toBe('scheduled');
      expect(p.attempts).toBe(0);
      expect(p.maxAttempts).toBe(3);
      expect(p.pullEvents()).toEqual([
        {
          type: 'publishing.publication_scheduled',
          occurredAt: now.toISOString(),
          payload: {
            publicationId: 'pub-1',
            contentPieceId: 'cp-1',
            scheduledAt: '2026-10-15T16:00:00.000Z',
          },
        },
      ]);
    });

    it('rejeita data inválida', () => {
      expect(errorOf(() => aPublication({ scheduledAt: new Date('x') })).code).toBe(
        'invalid_scheduled_at',
      );
    });
  });

  describe('reschedule', () => {
    it('de scheduled: muda o horário e emite publication_rescheduled', () => {
      const p = aPublication();
      const at = new Date('2026-10-16T08:00:00.000Z');
      p.reschedule(at, now);

      expect(p.status).toBe('scheduled');
      expect(p.scheduledAt).toEqual(at);
      expect(p.pullEvents()).toEqual([
        {
          type: 'publishing.publication_rescheduled',
          occurredAt: now.toISOString(),
          payload: {
            publicationId: 'pub-1',
            contentPieceId: 'cp-1',
            scheduledAt: at.toISOString(),
          },
        },
      ]);
    });

    it('de failed: volta a scheduled com uma nova rodada de tentativas', () => {
      const p = exhausted();
      p.pullEvents();
      const later = new Date('2026-10-20T08:00:00.000Z');
      p.reschedule(later, new Date('2026-10-16T00:00:00.000Z'));

      expect(p.status).toBe('scheduled');
      expect(p.attempts).toBe(0);
      expect(p.lastError).toBe('timeout');
      expect(p.pullEvents().map((e) => e.type)).toEqual(['publishing.publication_rescheduled']);
    });

    it.each([
      ['no passado', new Date('2026-10-15T11:00:00.000Z')],
      ['agora', now],
    ])('rejeita horário %s', (_label, at) => {
      expect(errorOf(() => aPublication().reschedule(at, now)).code).toBe('scheduled_at_in_past');
    });

    it.each([
      ['publishing', publishing],
      ['published', published],
      ['cancelled', cancelled],
    ])('rejeita a partir de %s', (from, make) => {
      const error = errorOf(() => make().reschedule(new Date('2026-12-01T00:00:00Z'), now));
      expect(error.code).toBe('invalid_transition');
      expect(error.details).toEqual({ from, action: 'reschedule' });
    });
  });

  describe('startPublishing', () => {
    it('no horário: vai para publishing e conta a tentativa', () => {
      const p = aPublication();
      p.startPublishing(dueAt);

      expect(p.status).toBe('publishing');
      expect(p.attempts).toBe(1);
      expect(p.pullEvents()).toEqual([]);
    });

    it('antes do horário: recusa', () => {
      expect(errorOf(() => aPublication().startPublishing(now)).code).toBe('publication_not_due');
    });

    it.each([
      ['publishing', publishing],
      ['published', published],
      ['failed', exhausted],
      ['cancelled', cancelled],
    ])('rejeita a partir de %s', (from, make) => {
      const error = errorOf(() => make().startPublishing(new Date('2026-12-01T00:00:00Z')));
      expect(error.code).toBe('invalid_transition');
      expect(error.details).toEqual({ from, action: 'startPublishing' });
    });
  });

  describe('markPublished', () => {
    it('guarda id e link e emite publication_published', () => {
      const p = publishing();
      p.markPublished(
        { externalMediaId: 'm-1', permalink: 'https://www.instagram.com/p/X/' },
        afterDue,
      );

      expect(p.status).toBe('published');
      expect(p.externalMediaId).toBe('m-1');
      expect(p.permalink).toBe('https://www.instagram.com/p/X/');
      expect(p.publishedAt).toEqual(afterDue);
      expect(p.pullEvents()).toEqual([
        {
          type: 'publishing.publication_published',
          occurredAt: afterDue.toISOString(),
          payload: {
            publicationId: 'pub-1',
            contentPieceId: 'cp-1',
            permalink: 'https://www.instagram.com/p/X/',
            publishedAt: afterDue.toISOString(),
          },
        },
      ]);
    });

    it('rejeita resultado sem link', () => {
      const error = errorOf(() =>
        publishing().markPublished({ externalMediaId: 'm-1', permalink: ' ' }, afterDue),
      );
      expect(error.code).toBe('invalid_publish_result');
    });

    it.each([
      ['scheduled', () => aPublication()],
      ['published', published],
      ['failed', exhausted],
      ['cancelled', cancelled],
    ])('rejeita a partir de %s', (from, make) => {
      const error = errorOf(() =>
        make().markPublished({ externalMediaId: 'm', permalink: 'https://x/' }, afterDue),
      );
      expect(error.details).toEqual({ from, action: 'markPublished' });
    });
  });

  describe('markAttemptFailed', () => {
    it('com tentativas sobrando: volta a scheduled no horário de retry, sem evento', () => {
      const p = publishing();
      const retryAt = minutesAfter(afterDue, 10);
      p.markAttemptFailed('timeout', afterDue, retryAt);

      expect(p.status).toBe('scheduled');
      expect(p.scheduledAt).toEqual(retryAt);
      expect(p.lastError).toBe('timeout');
      expect(p.pullEvents()).toEqual([]);
    });

    it('na terceira falha: vai para failed e emite publication_failed', () => {
      const p = aPublication();
      const statuses: string[] = [];
      let at = afterDue;
      for (let i = 1; i <= 3; i += 1) {
        p.startPublishing(at);
        const retryAt = minutesAfter(at, 10);
        p.markAttemptFailed(`erro ${i}`, at, retryAt);
        statuses.push(p.status);
        if (i < 3) at = retryAt;
      }

      expect(statuses).toEqual(['scheduled', 'scheduled', 'failed']);
      expect(p.attempts).toBe(3);
      expect(p.pullEvents()).toEqual([
        {
          type: 'publishing.publication_failed',
          occurredAt: at.toISOString(),
          payload: { publicationId: 'pub-1', contentPieceId: 'cp-1', error: 'erro 3', attempts: 3 },
        },
      ]);
    });

    it('a publicação de retry só fica devida no novo horário', () => {
      const p = publishing();
      const retryAt = minutesAfter(afterDue, 10);
      p.markAttemptFailed('timeout', afterDue, retryAt);

      expect(errorOf(() => p.startPublishing(minutesAfter(afterDue, 5))).code).toBe(
        'publication_not_due',
      );
      p.startPublishing(retryAt);
      expect(p.attempts).toBe(2);
    });

    it.each([
      ['scheduled', () => aPublication()],
      ['published', published],
      ['failed', exhausted],
      ['cancelled', cancelled],
    ])('rejeita a partir de %s', (from, make) => {
      const error = errorOf(() => make().markAttemptFailed('x', afterDue, afterDue));
      expect(error.details).toEqual({ from, action: 'markAttemptFailed' });
    });
  });

  describe('cancel', () => {
    it.each([
      ['scheduled', () => aPublication()],
      ['failed', exhausted],
    ])('cancela a partir de %s, sem evento', (_from, make) => {
      const p = make();
      p.pullEvents();
      p.cancel();
      expect(p.status).toBe('cancelled');
      expect(p.pullEvents()).toEqual([]);
    });

    it.each([
      ['publishing', publishing],
      ['published', published],
      ['cancelled', cancelled],
    ])('rejeita a partir de %s', (from, make) => {
      const error = errorOf(() => make().cancel());
      expect(error.code).toBe('invalid_transition');
      expect(error.details).toEqual({ from, action: 'cancel' });
      expect(error.message).toMatch(/^Não é possível cancelar/);
    });
  });

  it('sobrevive a ida e volta pelo snapshot', () => {
    const p = published();
    expect(Publication.fromSnapshot(p.toSnapshot()).toSnapshot()).toEqual(p.toSnapshot());
  });
});
