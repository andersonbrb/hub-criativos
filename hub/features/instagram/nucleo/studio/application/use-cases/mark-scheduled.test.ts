import { describe, expect, it } from 'vitest';
import { aContentPiece, createStudioTestKit } from '../../testing';

describe('MarkScheduled e MarkPublished', () => {
  it('agenda uma peça aprovada', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'approved' }));

    const piece = await kit.markScheduled.execute({
      publicationId: 'pub-9',
      contentPieceId: 'piece-1',
      scheduledAt: '2026-10-16T16:00:00.000Z',
    });

    expect(piece.status).toBe('scheduled');
    expect(piece.publication).toMatchObject({
      id: 'pub-9',
      scheduledAt: new Date('2026-10-16T16:00:00.000Z'),
      status: 'scheduled',
      permalink: null,
    });
  });

  it('reagenda uma peça já agendada', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'scheduled' }));

    const piece = await kit.markScheduled.execute({
      publicationId: 'pub-1',
      contentPieceId: 'piece-1',
      scheduledAt: '2026-10-18T01:00:00.000Z',
    });

    expect(piece.status).toBe('scheduled');
    expect(piece.publication?.scheduledAt).toEqual(new Date('2026-10-18T01:00:00.000Z'));
  });

  it('não agenda peça que não foi aprovada', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'awaiting_approval' }));

    await expect(
      kit.markScheduled.execute({
        publicationId: 'pub-1',
        contentPieceId: 'piece-1',
        scheduledAt: '2026-10-16T16:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });

  it('marca como publicada e ignora a reentrega do evento', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'scheduled' }));
    const input = {
      publicationId: 'pub-1',
      contentPieceId: 'piece-1',
      permalink: 'https://www.instagram.com/p/ES999/',
      publishedAt: '2026-10-16T16:00:04.000Z',
    };

    const piece = await kit.markPublished.execute(input);
    const again = await kit.markPublished.execute(input);

    expect(piece.status).toBe('published');
    expect(piece.publication).toMatchObject({
      status: 'published',
      permalink: 'https://www.instagram.com/p/ES999/',
      publishedAt: new Date('2026-10-16T16:00:04.000Z'),
    });
    expect(again.version).toBe(piece.version);
  });

  it('não publica peça que não estava agendada', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'approved' }));

    await expect(
      kit.markPublished.execute({
        publicationId: 'pub-1',
        contentPieceId: 'piece-1',
        permalink: 'https://www.instagram.com/p/X/',
        publishedAt: '2026-10-16T16:00:04.000Z',
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition', details: { from: 'approved' } });
  });
});
