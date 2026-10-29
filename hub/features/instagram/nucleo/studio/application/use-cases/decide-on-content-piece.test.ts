import { ContentPieceId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { REVIEWER, aContentPiece, createStudioTestKit } from '../../testing';

async function kitWithPieceAwaitingApproval(blocking = false) {
  const kit = createStudioTestKit();
  const piece = aContentPiece({ status: 'ai_review' });
  piece.recordAutomatedReview(
    { reportId: 'report-1', score: blocking ? 40 : 95, hasBlockingIssues: blocking },
    new Date('2026-10-15T12:00:00Z'),
  );
  await kit.pieces.save(piece);
  return kit;
}

describe('DecideOnContentPiece', () => {
  it('aprova, salva e publica content_piece_approved', async () => {
    const kit = await kitWithPieceAwaitingApproval();

    const piece = await kit.decide.execute({
      contentPieceId: 'piece-1',
      reviewerId: REVIEWER,
      decision: { action: 'approve' },
    });

    expect(piece.status).toBe('approved');
    expect((await kit.pieces.findById(piece.id))!.status).toBe('approved');
    expect(kit.events.published).toEqual([
      {
        type: 'studio.content_piece_approved',
        occurredAt: '2026-10-15T12:00:00.000Z',
        payload: {
          contentPieceId: 'piece-1',
          marketId: 'market-es',
          channelId: 'channel-es',
          format: 'reel',
          approvedBy: REVIEWER,
        },
      },
    ]);
    expect(kit.jobs.jobs).toEqual([]);
  });

  it('não aprova com problema bloqueante e não salva nada', async () => {
    const kit = await kitWithPieceAwaitingApproval(true);

    await expect(
      kit.decide.execute({
        contentPieceId: 'piece-1',
        reviewerId: REVIEWER,
        decision: { action: 'approve' },
      }),
    ).rejects.toMatchObject({ code: 'blocking_issues_unresolved' });
    expect((await kit.pieces.findById(ContentPieceId('piece-1')))!.status).toBe(
      'awaiting_approval',
    );
    expect(kit.events.published).toEqual([]);
  });

  it('reprova com motivo', async () => {
    const kit = await kitWithPieceAwaitingApproval(true);

    const piece = await kit.decide.execute({
      contentPieceId: 'piece-1',
      reviewerId: REVIEWER,
      decision: { action: 'reject', reason: 'Termo proibido na legenda.' },
    });

    expect(piece.status).toBe('rejected');
    expect(kit.events.published).toEqual([
      expect.objectContaining({
        type: 'studio.content_piece_rejected',
        payload: {
          contentPieceId: 'piece-1',
          rejectedBy: REVIEWER,
          reason: 'Termo proibido na legenda.',
        },
      }),
    ]);
  });

  it('pedir ajustes publica o evento e reenfileira a produção', async () => {
    const kit = await kitWithPieceAwaitingApproval(true);

    const piece = await kit.decide.execute({
      contentPieceId: 'piece-1',
      reviewerId: REVIEWER,
      decision: { action: 'request_changes', suggestion: 'Troque o gancho.' },
    });

    expect(piece.status).toBe('changes_requested');
    expect(kit.events.typesPublished()).toEqual(['studio.content_piece_changes_requested']);
    expect(kit.events.published[0]!.payload).toEqual({
      contentPieceId: 'piece-1',
      requestedBy: REVIEWER,
      suggestion: 'Troque o gancho.',
    });
    expect(kit.jobs.jobs).toEqual([
      { job: 'studio.produce', payload: { contentPieceId: 'piece-1' } },
    ]);
  });

  it('sugestão curta demais não reenfileira nada', async () => {
    const kit = await kitWithPieceAwaitingApproval();

    await expect(
      kit.decide.execute({
        contentPieceId: 'piece-1',
        reviewerId: REVIEWER,
        decision: { action: 'request_changes', suggestion: ' ok ' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_change_suggestion' });
    expect(kit.jobs.jobs).toEqual([]);
  });

  it('não decide sobre peça que não está aguardando aprovação', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'producing' }));

    await expect(
      kit.decide.execute({
        contentPieceId: 'piece-1',
        reviewerId: REVIEWER,
        decision: { action: 'reject', reason: 'Qualquer motivo.' },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_transition',
      details: { from: 'producing', action: 'reject' },
    });
  });

  it('exige um revisor identificado', async () => {
    const kit = await kitWithPieceAwaitingApproval();

    await expect(
      kit.decide.execute({
        contentPieceId: 'piece-1',
        reviewerId: ' ',
        decision: { action: 'approve' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_id' });
  });
});

describe('EditCaption', () => {
  it('edita a legenda da revisão atual e registra quem editou', async () => {
    const kit = await kitWithPieceAwaitingApproval();

    const piece = await kit.editCaption.execute({
      contentPieceId: 'piece-1',
      editorId: REVIEWER,
      caption: 'Oración corta.',
      hashtags: ['#sanbenito', 'oracion'],
    });

    expect(piece.status).toBe('awaiting_approval');
    const stored = (await kit.pieces.findById(piece.id))!;
    expect(stored.currentRevision).toMatchObject({
      caption: 'Oración corta.',
      hashtags: ['#sanbenito', '#oracion'],
    });
    expect(stored.history.at(-1)).toMatchObject({
      by: REVIEWER,
      note: 'Legenda editada pelo revisor.',
    });
  });

  it('só edita peças aguardando aprovação', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'approved' }));

    await expect(
      kit.editCaption.execute({
        contentPieceId: 'piece-1',
        editorId: REVIEWER,
        caption: 'x',
        hashtags: [],
      }),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});
