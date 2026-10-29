import {
  InMemoryEventBus,
  domainEvent,
  type AutomatedReviewCompleted,
  type PublicationPublished,
  type PublicationRescheduled,
  type PublicationScheduled,
  type ReferencePostSelected,
} from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { REVIEWER, aReferencePostSelectedPayload, createStudioTestKit } from '../../testing';
import { subscribeStudioEventHandlers } from './studio-event-handlers';

const at = new Date('2026-10-15T12:00:00.000Z');

describe('handlers de eventos do Estúdio', () => {
  it('leva uma peça da seleção do post até a publicação reagindo aos eventos', async () => {
    const kit = createStudioTestKit();
    const bus = new InMemoryEventBus();
    subscribeStudioEventHandlers(bus, kit);

    const selected: ReferencePostSelected = domainEvent(
      'reference.post_selected',
      at,
      aReferencePostSelectedPayload(),
    );
    await bus.publish([selected]);
    const pieces = await kit.pieces.list();
    expect(pieces.map((p) => p.marketId).sort()).toEqual(['market-es', 'market-fr']);

    const es = pieces.find((p) => p.marketId === 'market-es')!;
    await kit.produce.execute({ contentPieceId: es.id });

    const reviewed: AutomatedReviewCompleted = domainEvent(
      'governance.automated_review_completed',
      at,
      {
        reviewReportId: 'report-1',
        contentPieceId: es.id,
        revisionNumber: 1,
        score: 100,
        hasBlockingIssues: false,
      },
    );
    await bus.publish([reviewed]);
    expect((await kit.getContentPiece.execute(es.id)).status).toBe('awaiting_approval');

    await kit.decide.execute({
      contentPieceId: es.id,
      reviewerId: REVIEWER,
      decision: { action: 'approve' },
    });

    const scheduled: PublicationScheduled = domainEvent('publishing.publication_scheduled', at, {
      publicationId: 'pub-1',
      contentPieceId: es.id,
      scheduledAt: '2026-10-16T16:00:00.000Z',
    });
    const rescheduled: PublicationRescheduled = domainEvent(
      'publishing.publication_rescheduled',
      at,
      { publicationId: 'pub-1', contentPieceId: es.id, scheduledAt: '2026-10-17T02:00:00.000Z' },
    );
    await bus.publish([scheduled, rescheduled]);
    expect((await kit.getContentPiece.execute(es.id)).publication?.scheduledAt).toEqual(
      new Date('2026-10-17T02:00:00.000Z'),
    );

    const published: PublicationPublished = domainEvent('publishing.publication_published', at, {
      publicationId: 'pub-1',
      contentPieceId: es.id,
      permalink: 'https://www.instagram.com/p/ES1/',
      publishedAt: '2026-10-17T02:00:02.000Z',
    });
    await bus.publish([published]);

    const final = await kit.getContentPiece.execute(es.id);
    expect(final.status).toBe('published');
    expect(final.history.map((h) => h.to)).toEqual([
      'queued',
      'producing',
      'ai_review',
      'awaiting_approval',
      'approved',
      'scheduled',
      'scheduled',
      'published',
    ]);
  });
});
