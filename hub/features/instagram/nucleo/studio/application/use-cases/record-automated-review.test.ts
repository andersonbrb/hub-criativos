import { describe, expect, it } from 'vitest';
import { aContentPiece, createStudioTestKit } from '../../testing';

const review = (overrides: Partial<{ revisionNumber: number; reviewReportId: string }> = {}) => ({
  reviewReportId: 'report-7',
  contentPieceId: 'piece-1',
  revisionNumber: 1,
  score: 75,
  hasBlockingIssues: false,
  ...overrides,
});

describe('RecordAutomatedReview', () => {
  it('registra o relatório e libera a peça para o revisor', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'ai_review' }));

    const piece = await kit.recordAutomatedReview.execute(review());

    expect(piece.status).toBe('awaiting_approval');
    expect(piece.currentRevision.automatedReview).toEqual({
      reportId: 'report-7',
      score: 75,
      hasBlockingIssues: false,
    });
    expect((await kit.pieces.findById(piece.id))!.status).toBe('awaiting_approval');
  });

  it('ignora relatório de uma revisão que não é mais a atual', async () => {
    const kit = createStudioTestKit();
    const piece = aContentPiece({ status: 'changes_requested' });
    piece.startProduction(new Date('2026-10-15T13:00:00Z'));
    piece.completeProduction(
      {
        caption: 'Revisão 2',
        hashtags: [],
        assets: { format: 'reel', videoUrl: 'https://cdn.example.com/v2.mp4', coverUrl: null },
      },
      new Date('2026-10-15T13:05:00Z'),
    );
    await kit.pieces.save(piece);
    const versionBefore = (await kit.pieces.findById(piece.id))!.version;

    const result = await kit.recordAutomatedReview.execute(review({ revisionNumber: 1 }));

    expect(result.status).toBe('ai_review');
    expect(result.currentRevision.automatedReview).toBeNull();
    expect((await kit.pieces.findById(piece.id))!.version).toBe(versionBefore);
  });

  it('ignora a reentrega do mesmo relatório', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'ai_review' }));
    await kit.recordAutomatedReview.execute(review());

    const again = await kit.recordAutomatedReview.execute(review());

    expect(again.status).toBe('awaiting_approval');
  });

  it('um relatório novo para a revisão atual fora de ai_review é uma transição inválida', async () => {
    const kit = createStudioTestKit();
    await kit.pieces.save(aContentPiece({ status: 'approved' }));

    await expect(
      kit.recordAutomatedReview.execute(review({ reviewReportId: 'report-8' })),
    ).rejects.toMatchObject({ code: 'invalid_transition' });
  });
});
