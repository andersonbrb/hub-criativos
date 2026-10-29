import { ContentPieceId, ReviewReportId } from '@sbs/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReviewCheck, ReviewReport } from '../../domain';
import { InMemoryReviewReportRepository } from '../../infrastructure';
import { GetLatestReviewReport } from './get-latest-review-report';
import { GetReviewReport } from './get-review-report';

const report = (id: string, revisionNumber: number, at: string) =>
  ReviewReport.create(
    ReviewReportId(id),
    {
      contentPieceId: ContentPieceId('piece-1'),
      revisionNumber,
      checks: [ReviewCheck.pass('caption_length', 'Tamanho da legenda', 'Ok.')],
    },
    new Date(at),
  );

describe('consultas de relatório de revisão', () => {
  let reports: InMemoryReviewReportRepository;

  beforeEach(async () => {
    reports = new InMemoryReviewReportRepository();
    await reports.save(report('r-2', 2, '2026-10-15T12:00:00Z'));
    await reports.save(report('r-1', 1, '2026-10-15T13:00:00Z'));
  });

  it('busca por id', async () => {
    const found = await new GetReviewReport(reports).execute('r-1');
    expect(found.revisionNumber).toBe(1);
    expect(found.version).toBe(1);
  });

  it('id inexistente é not_found', async () => {
    await expect(new GetReviewReport(reports).execute('x')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('o mais recente é o da maior revisão, não o último gravado', async () => {
    const latest = await new GetLatestReviewReport(reports).execute('piece-1');
    expect(latest?.id).toBe('r-2');
  });

  it('peça sem revisão automática devolve null', async () => {
    expect(await new GetLatestReviewReport(reports).execute('piece-2')).toBeNull();
  });
});
