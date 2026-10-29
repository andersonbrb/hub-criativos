import { ContentPieceId, ReviewReportId } from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReviewCheck, ReviewReport } from '../../domain';
import { FakeContentReviewer, InMemoryReviewReportRepository } from '../../infrastructure';
import { InMemoryContentForReview, aReviewableContent } from '../../testing';
import type { ContentReviewer } from '../ports/content-reviewer';
import { ReviewEditedCaption } from './review-edited-caption';

const NOW = '2026-10-15T12:30:00.000Z';
const EDITED = 'Oración de San Benito para cuidar tu hogar. Rézala con fe esta noche. 🙏';

describe('ReviewEditedCaption', () => {
  let reports: InMemoryReviewReportRepository;
  let content: InMemoryContentForReview;
  let events: RecordingEventBus;
  let reviewer: FakeContentReviewer;
  let ids: SequentialIdGenerator;
  let clock: FixedClock;

  const useCase = (r: ContentReviewer = reviewer, aiTimeoutMs?: number) =>
    new ReviewEditedCaption(
      reports,
      content,
      r,
      ids,
      clock,
      events,
      aiTimeoutMs === undefined ? {} : { aiTimeoutMs },
    );

  /** Relatório da produção (com o revisor geral), já registrado na peça. */
  async function producedReport(extra: ReviewCheck[] = []): Promise<ReviewReport> {
    const report = ReviewReport.create(
      ReviewReportId('report-1'),
      {
        contentPieceId: ContentPieceId('piece-1'),
        revisionNumber: 1,
        checks: [
          ReviewCheck.pass('caption_length', 'Tamanho da legenda', 'ok'),
          ReviewCheck.pass('translation_fidelity', 'Fidelidade da tradução', 'Fiel à original.'),
          ReviewCheck.pass('brand_tone', 'Tom da marca', 'Acolhedor.'),
          ReviewCheck.pass('general_review', 'Revisor geral', 'Mídia e legenda conversam.'),
          ...extra,
        ],
      },
      new Date('2026-10-15T12:00:00.000Z'),
    );
    report.pullEvents();
    await reports.save(report);
    content.put(aReviewableContent({ reviewReportId: report.id }));
    return report;
  }

  beforeEach(() => {
    reports = new InMemoryReviewReportRepository();
    content = new InMemoryContentForReview();
    events = new RecordingEventBus();
    reviewer = new FakeContentReviewer();
    ids = new SequentialIdGenerator('edit-report');
    clock = new FixedClock(NOW);
    content.put(aReviewableContent());
  });

  it('passa a legenda editada pelo mesmo revisor de IA e grava um novo relatório da revisão', async () => {
    const report = await useCase().execute({
      contentPieceId: 'piece-1',
      caption: `  ${EDITED}  `,
      hashtags: ['sanbenito', 'oracion'],
    });

    const piece = aReviewableContent();
    expect(reviewer.calls).toEqual([
      {
        format: piece.format,
        caption: EDITED,
        hashtags: ['sanbenito', 'oracion'],
        sourceCaption: piece.sourceCaption,
        market: piece.market,
      },
    ]);
    expect(report).toMatchObject({ revisionNumber: 1, trigger: 'caption_edit', score: 100 });
    expect(report.checks.map((c) => c.code)).toContain('forbidden_claims');
    expect(
      (await reports.findByRevision(ContentPieceId('piece-1'), 1))?.toSnapshot(),
    ).toMatchObject({ id: report.id, trigger: 'caption_edit' });
    expect(events.published).toEqual([
      {
        type: 'governance.caption_edit_reviewed',
        occurredAt: NOW,
        payload: {
          reviewReportId: 'edit-report-1',
          contentPieceId: 'piece-1',
          revisionNumber: 1,
          score: 100,
          hasBlockingIssues: false,
        },
      },
    ]);
  });

  it('reprovação bloqueante da IA fica no relatório (a edição segue, a aprovação não)', async () => {
    const report = await useCase().execute({
      contentPieceId: 'piece-1',
      caption: 'San Benito: cura garantizada para tu familia.',
      hashtags: ['sanbenito'],
    });

    expect(report.hasBlockingIssues).toBe(true);
    expect(report.checks.find((c) => c.code === 'forbidden_claims')).toMatchObject({
      status: 'fail',
      blocking: true,
    });
    expect(events.published[0]?.payload).toMatchObject({ hasBlockingIssues: true });
  });

  it('recusa a edição que falha nas regras, sem chamar a IA nem gravar relatório', async () => {
    await expect(
      useCase().execute({
        contentPieceId: 'piece-1',
        caption: 'San Benito y el Sagrado Verso.',
        hashtags: [],
      }),
    ).rejects.toMatchObject({ code: 'caption_blocked_by_rules' });

    expect(reviewer.calls).toEqual([]);
    expect(await reports.findByRevision(ContentPieceId('piece-1'), 1)).toBeNull();
    expect(events.published).toEqual([]);
  });

  it('IA fora do ar vira aviso e não trava o revisor', async () => {
    const offline = new FakeContentReviewer({ failWith: new Error('cota esgotada') });

    const report = await useCase(offline).execute({
      contentPieceId: 'piece-1',
      caption: EDITED,
      hashtags: ['sanbenito'],
    });

    const unavailable = report.checks.find((c) => c.code === 'ai_reviewer_unavailable');
    expect(unavailable).toMatchObject({ status: 'warn', blocking: false });
    expect(unavailable?.message).toContain('cota esgotada');
    expect(report.hasBlockingIssues).toBe(false);
  });

  it('IA que demora além do limite vira aviso', async () => {
    const slow: ContentReviewer = { review: () => new Promise(() => undefined) };

    const report = await useCase(slow, 5).execute({
      contentPieceId: 'piece-1',
      caption: EDITED,
      hashtags: ['sanbenito'],
    });

    expect(report.checks.find((c) => c.code === 'ai_reviewer_unavailable')?.message).toContain(
      'sem resposta',
    );
  });

  it('mudou só espaço, quebra de linha ou #: reaproveita a IA do relatório atual', async () => {
    const previous = await producedReport();
    const current = aReviewableContent();

    const report = await useCase().execute({
      contentPieceId: 'piece-1',
      caption: current.caption.replace('. ', '.\n\n'),
      hashtags: current.hashtags.map((t) => `#${t.toUpperCase()}`),
    });

    expect(reviewer.calls).toEqual([]);
    const ai = (r: ReviewReport) =>
      r.checks.filter((c) => ['translation_fidelity', 'brand_tone'].includes(c.code));
    expect(ai(report)).toEqual(ai(previous));
    // As regras rodam de novo sempre (são baratas).
    expect(report.checks.map((c) => c.code)).toContain('product_mention');
    expect(report.checks.find((c) => c.code === 'general_review')?.message).toBe(
      'Mídia e legenda conversam.',
    );
  });

  it('mesmo texto, mas a IA tinha falhado: tenta a IA de novo', async () => {
    await producedReport([
      ReviewCheck.warn('ai_reviewer_unavailable', 'Revisor de IA', 'O revisor não respondeu.'),
    ]);

    const report = await useCase().execute({
      contentPieceId: 'piece-1',
      caption: aReviewableContent().caption,
      hashtags: aReviewableContent().hashtags,
    });

    expect(reviewer.calls).toHaveLength(1);
    expect(report.checks.some((c) => c.code === 'ai_reviewer_unavailable')).toBe(false);
  });

  it('mantém o parecer do revisor geral, sinalizado como sobre a legenda anterior', async () => {
    await producedReport();

    const report = await useCase().execute({
      contentPieceId: 'piece-1',
      caption: EDITED,
      hashtags: ['sanbenito'],
    });
    const general = report.checks.find((c) => c.code === 'general_review');

    expect(general?.message).toBe(
      'Parecer sobre a legenda anterior à edição: Mídia e legenda conversam.',
    );

    // Uma segunda edição não repete o aviso.
    content.put(aReviewableContent({ caption: EDITED, reviewReportId: report.id }));
    clock.advanceMinutes(5);
    const again = await useCase().execute({
      contentPieceId: 'piece-1',
      caption: `${EDITED} Amén.`,
      hashtags: ['sanbenito'],
    });
    expect(again.checks.find((c) => c.code === 'general_review')?.message).toBe(general?.message);
    expect((await reports.findByRevision(ContentPieceId('piece-1'), 1))?.id).toBe(again.id);
  });

  it('propaga peça inexistente', async () => {
    await expect(
      useCase().execute({ contentPieceId: 'nao-existe', caption: EDITED, hashtags: [] }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
