import { ContentPieceId, DomainError, ReviewReportId } from '@sbs/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ReviewCheck } from './review-check';
import { ReviewReport } from './review-report';

const now = new Date('2026-10-15T12:00:00Z');

const pass = (code: string) => ReviewCheck.pass(code, 'Checagem', 'Tudo certo.');
const warn = (code: string) => ReviewCheck.warn(code, 'Checagem', 'Atenção.');
const fail = (code: string, blocking = true) =>
  ReviewCheck.fail(code, 'Checagem', 'Problema.', blocking);

const create = (checks: ReviewCheck[], revisionNumber = 1) =>
  ReviewReport.create(
    ReviewReportId('report-1'),
    { contentPieceId: ContentPieceId('piece-1'), revisionNumber, checks },
    now,
  );

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('ReviewReport', () => {
  it.each([
    ['tudo aprovado', [pass('a_a'), pass('b_b')], 100],
    ['um aviso', [pass('a_a'), warn('b_b')], 90],
    ['uma reprovação', [fail('a_a'), pass('b_b')], 75],
    ['uma reprovação não bloqueante', [fail('a_a', false)], 75],
    ['uma reprovação e dois avisos', [fail('a_a'), warn('b_b'), warn('c_c')], 55],
    ['quatro reprovações', [fail('a_a'), fail('b_b'), fail('c_c'), fail('d_d')], 0],
    ['nunca abaixo de zero', [fail('a_a'), fail('b_b'), fail('c_c'), fail('d_d'), warn('e_e')], 0],
  ])('score com %s = %i', (_label, checks, score) => {
    expect(create(checks).score).toBe(score);
  });

  it('tem problema bloqueante só se alguma reprovação bloqueia', () => {
    expect(create([pass('a_a'), warn('b_b'), fail('c_c', false)]).hasBlockingIssues).toBe(false);
    expect(create([pass('a_a'), fail('c_c', true)]).hasBlockingIssues).toBe(true);
  });

  it('emite automated_review_completed com score e bloqueio', () => {
    const report = create([fail('forbidden_terms'), warn('product_mention'), pass('a_a')], 3);

    expect(report.pullEvents()).toEqual([
      {
        type: 'governance.automated_review_completed',
        occurredAt: '2026-10-15T12:00:00.000Z',
        payload: {
          reviewReportId: 'report-1',
          contentPieceId: 'piece-1',
          revisionNumber: 3,
          score: 65,
          hasBlockingIssues: true,
        },
      },
    ]);
  });

  it.each([
    ['revisão zero', () => create([pass('a_a')], 0), 'invalid_revision_number'],
    ['revisão fracionária', () => create([pass('a_a')], 1.5), 'invalid_revision_number'],
    ['sem checagens', () => create([]), 'empty_review_report'],
    ['checagem repetida', () => create([pass('a_a'), warn('a_a')]), 'duplicate_review_check'],
  ])('rejeita %s', (_label, fn, code) => {
    expect(errorCode(fn)).toBe(code);
  });

  it('sobrevive a ida e volta pelo snapshot', () => {
    const report = create([fail('a_a'), warn('b_b'), pass('c_c')], 2);
    const copy = ReviewReport.fromSnapshot(report.toSnapshot());

    expect(copy.toSnapshot()).toEqual(report.toSnapshot());
    expect(copy.score).toBe(report.score);
    expect(copy.hasBlockingIssues).toBe(true);
    expect(copy.pullEvents()).toEqual([]);
  });

  it('da legenda editada: mesma revisão, outro evento (o studio não reage a ele)', () => {
    const report = ReviewReport.create(
      ReviewReportId('report-2'),
      {
        contentPieceId: ContentPieceId('piece-1'),
        revisionNumber: 1,
        checks: [pass('a_a')],
        trigger: 'caption_edit',
      },
      now,
    );

    expect(report.trigger).toBe('caption_edit');
    expect(report.pullEvents().map((e) => e.type)).toEqual(['governance.caption_edit_reviewed']);
    expect(ReviewReport.fromSnapshot(report.toSnapshot()).trigger).toBe('caption_edit');
  });

  it('snapshot antigo, sem `trigger`, é da produção', () => {
    const { trigger: _trigger, ...old } = create([pass('a_a')]).toSnapshot();

    expect(ReviewReport.fromSnapshot(old).trigger).toBe('production');
  });
});
