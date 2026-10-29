import { ContentPieceId, domainEvent, type ContentPieceProduced } from '@sbs/shared-kernel';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@sbs/shared-kernel/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReviewCheckProps } from '../../domain';
import { FakeContentReviewer, InMemoryReviewReportRepository } from '../../infrastructure';
import { InMemoryContentForReview, aReviewableContent } from '../../testing';
import { onContentPieceProduced } from '../event-handlers/on-content-piece-produced';
import type { ContentReviewer } from '../ports/content-reviewer';
import type { GeneralReviewInput, GeneralReviewer } from '../ports/general-reviewer';
import { RunAutomatedReview } from './run-automated-review';

describe('RunAutomatedReview', () => {
  let reports: InMemoryReviewReportRepository;
  let content: InMemoryContentForReview;
  let events: RecordingEventBus;
  let reviewer: FakeContentReviewer;
  let ids: SequentialIdGenerator;

  const useCase = (r: ContentReviewer = reviewer) =>
    new RunAutomatedReview(
      reports,
      content,
      r,
      ids,
      new FixedClock('2026-10-15T12:00:00.000Z'),
      events,
    );

  beforeEach(() => {
    reports = new InMemoryReviewReportRepository();
    content = new InMemoryContentForReview();
    events = new RecordingEventBus();
    reviewer = new FakeContentReviewer();
    ids = new SequentialIdGenerator('report');
    content.put(aReviewableContent());
  });

  it('roda regras e IA, salva o relatório e publica o evento', async () => {
    const report = await useCase().execute({ contentPieceId: 'piece-1', revisionNumber: 1 });

    expect(report?.checks.map((c) => c.code)).toEqual([
      'caption_length',
      'hashtag_count',
      'forbidden_terms',
      'product_mention',
      'assets_present',
      'ai_label',
      'translation_fidelity',
      'religious_accuracy',
      'forbidden_claims',
      'brand_tone',
    ]);
    expect(report?.score).toBe(100);
    expect(await reports.findLatestByContentPiece(ContentPieceId('piece-1'))).not.toBeNull();
    expect(events.published).toEqual([
      {
        type: 'governance.automated_review_completed',
        occurredAt: '2026-10-15T12:00:00.000Z',
        payload: {
          reviewReportId: 'report-1',
          contentPieceId: 'piece-1',
          revisionNumber: 1,
          score: 100,
          hasBlockingIssues: false,
        },
      },
    ]);
  });

  it('envia ao revisor de IA a legenda, a original e o perfil do mercado', async () => {
    await useCase().execute({ contentPieceId: 'piece-1', revisionNumber: 1 });

    const piece = aReviewableContent();
    expect(reviewer.calls).toEqual([
      {
        format: piece.format,
        caption: piece.caption,
        hashtags: piece.hashtags,
        sourceCaption: piece.sourceCaption,
        market: piece.market,
      },
    ]);
  });

  it('combina reprovações de regra e de IA no score e no bloqueio', async () => {
    content.put(
      aReviewableContent({
        caption: 'Milagro garantizado con el Sagrado Verso.',
        hashtags: Array.from({ length: 12 }, (_, i) => `fe${i}`),
      }),
    );

    const report = await useCase().execute({ contentPieceId: 'piece-1', revisionNumber: 1 });

    // forbidden_terms + forbidden_claims reprovam; hashtag_count + product_mention avisam
    expect(report?.score).toBe(100 - 2 * 25 - 2 * 10);
    expect(report?.hasBlockingIssues).toBe(true);
    expect(events.published[0]?.payload).toMatchObject({ score: 30, hasBlockingIssues: true });
  });

  it('conclui a revisão com um aviso quando o revisor de IA falha', async () => {
    const offline = new FakeContentReviewer({ failWith: new Error('tempo esgotado') });

    const report = await useCase(offline).execute({ contentPieceId: 'piece-1', revisionNumber: 1 });

    const unavailable = report?.checks.find((c) => c.code === 'ai_reviewer_unavailable');
    expect(unavailable).toMatchObject({ status: 'warn', blocking: false });
    expect(unavailable?.message).toContain('tempo esgotado');
    expect(report?.checks.some((c) => c.code === 'translation_fidelity')).toBe(false);
    expect(report?.score).toBe(90);
    expect(report?.hasBlockingIssues).toBe(false);
    expect(events.typesPublished()).toEqual(['governance.automated_review_completed']);
  });

  it.each<[string, ReviewCheckProps[]]>([
    [
      'checagem malformada',
      [{ code: 'brand_tone', label: '', status: 'pass', blocking: false, message: 'ok' }],
    ],
    [
      'código que colide com uma regra',
      [{ code: 'caption_length', label: 'X', status: 'pass', blocking: false, message: 'ok' }],
    ],
  ])('trata resposta inválida da IA (%s) como revisor indisponível', async (_label, response) => {
    const broken: ContentReviewer = { review: async () => response };

    const report = await useCase(broken).execute({ contentPieceId: 'piece-1', revisionNumber: 1 });

    expect(report?.checks.at(-1)?.code).toBe('ai_reviewer_unavailable');
  });

  it('é idempotente: a mesma revisão não é revisada duas vezes', async () => {
    await useCase().execute({ contentPieceId: 'piece-1', revisionNumber: 1 });
    const again = await useCase().execute({ contentPieceId: 'piece-1', revisionNumber: 1 });

    expect(again).toBeNull();
    expect(reviewer.calls).toHaveLength(1);
    expect(events.published).toHaveLength(1);
  });

  it('revisa a nova revisão da mesma peça', async () => {
    await useCase().execute({ contentPieceId: 'piece-1', revisionNumber: 1 });
    content.put(aReviewableContent({ revisionNumber: 2 }));

    const second = await useCase().execute({ contentPieceId: 'piece-1', revisionNumber: 2 });

    expect(second?.revisionNumber).toBe(2);
    expect((await reports.findLatestByContentPiece(ContentPieceId('piece-1')))?.id).toBe(
      second?.id,
    );
  });

  it('ignora evento atrasado de uma revisão que já foi substituída', async () => {
    content.put(aReviewableContent({ revisionNumber: 2 }));

    const report = await useCase().execute({ contentPieceId: 'piece-1', revisionNumber: 1 });

    expect(report).toBeNull();
    expect(events.published).toEqual([]);
  });

  it('propaga peça inexistente', async () => {
    await expect(
      useCase().execute({ contentPieceId: 'nao-existe', revisionNumber: 1 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('reage a studio.content_piece_produced', async () => {
    const event: ContentPieceProduced = domainEvent(
      'studio.content_piece_produced',
      new Date('2026-10-15T11:59:00Z'),
      { contentPieceId: 'piece-1', marketId: 'market-es', revisionNumber: 1 },
    );

    await onContentPieceProduced(useCase())(event);

    expect(events.typesPublished()).toEqual(['governance.automated_review_completed']);
  });
});

describe('RunAutomatedReview — revisor geral', () => {
  const run = async (general: GeneralReviewer | null) => {
    const content = new InMemoryContentForReview();
    content.put(aReviewableContent());
    const useCase = new RunAutomatedReview(
      new InMemoryReviewReportRepository(),
      content,
      new FakeContentReviewer(),
      new SequentialIdGenerator('report'),
      new FixedClock('2026-10-15T12:00:00.000Z'),
      new RecordingEventBus(),
      general,
    );
    return (await useCase.execute({ contentPieceId: 'piece-1', revisionNumber: 1 }))!;
  };

  it('entra por último, com a mídia e o registro da produção, e nunca bloqueia', async () => {
    const seen: GeneralReviewInput[] = [];
    const report = await run({
      review: async (input) => {
        seen.push(input);
        return {
          code: 'qualquer',
          label: 'Revisor geral',
          status: 'fail',
          blocking: true,
          message: 'O gancho promete algo que o vídeo não entrega. Volte para a edição.',
        };
      },
    });
    const last = report.checks.at(-1)!;
    expect(last).toMatchObject({ code: 'general_review', status: 'fail', blocking: false });
    expect(report.hasBlockingIssues).toBe(false);
    expect(seen[0]!.assets).toEqual(aReviewableContent().assets);
    expect(seen[0]!.production[0]!.step).toBe('Edição');
  });

  it('indisponível (sem IA): não aparece; com erro: vira aviso', async () => {
    const without = await run({ review: async () => null });
    expect(without.checks.some((c) => c.code === 'general_review')).toBe(false);

    const failing = await run({
      review: async () => {
        throw new Error('cota esgotada');
      },
    });
    expect(failing.checks.at(-1)).toMatchObject({ code: 'general_review', status: 'warn' });
    expect(failing.checks.at(-1)!.message).toContain('cota esgotada');
  });
});
