import type {
  AiReview,
  ContentPiece as ContentPieceDto,
  ContentPieceSummary,
  Revision,
} from '@sbs/contracts';
import type { ReviewReport } from '@sbs/governance';
import type { ContentPiece, RevisionSnapshot } from '@sbs/studio';

/**
 * Busca o relatório completo da governança para uma revisão (para mostrar cada checagem):
 * o que a peça registrou (`reportId`, o da última edição da legenda, se houve) ou, sem ele,
 * o mais recente da revisão.
 */
export type ReviewLookup = (
  contentPieceId: string,
  revisionNumber: number,
  reportId: string | null,
) => Promise<ReviewReport | null>;

export async function toContentPieceDto(
  piece: ContentPiece,
  findReview: ReviewLookup,
): Promise<ContentPieceDto> {
  const s = piece.toSnapshot();
  const revisions = await Promise.all(
    s.revisions.map(async (r) =>
      toRevisionDto(r, await findReview(s.id, r.number, r.automatedReview?.reportId ?? null)),
    ),
  );
  const current = revisions[revisions.length - 1];
  if (!current) throw new Error(`Peça ${s.id} sem revisões.`);

  return {
    id: s.id,
    marketId: s.marketId,
    channelId: s.channelId,
    format: s.format,
    status: s.status,
    source: { referencePostId: s.referencePostId, ...s.source },
    productionOptions: { ...piece.productionOptions },
    currentRevision: current,
    revisions,
    history: s.history,
    failureReason: s.failureReason,
    publication: s.publication
      ? {
          id: s.publication.id,
          scheduledAt: s.publication.scheduledAt,
          status: s.publication.status,
          permalink: s.publication.permalink,
        }
      : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toContentPieceSummary(piece: ContentPiece): ContentPieceSummary {
  const s = piece.toSnapshot();
  const current = s.revisions[s.revisions.length - 1];
  const review = current?.automatedReview ?? null;
  return {
    id: s.id,
    marketId: s.marketId,
    channelId: s.channelId,
    format: s.format,
    status: s.status,
    thumbnailUrl: s.source.thumbnailUrl,
    captionPreview: (current?.caption || s.source.caption).slice(0, 140),
    revisionNumber: current?.number ?? 1,
    aiScore: review?.score ?? null,
    hasBlockingIssues: review?.hasBlockingIssues ?? null,
    scheduledAt: s.publication?.scheduledAt ?? null,
    updatedAt: s.updatedAt,
  };
}

function toRevisionDto(r: RevisionSnapshot, report: ReviewReport | null): Revision {
  return {
    number: r.number,
    createdAt: r.createdAt,
    caption: r.caption,
    hashtags: r.hashtags,
    assets: r.assets,
    requestedChanges: r.requestedChanges,
    aiReview: report ? toAiReview(report) : null,
    production: r.production ?? [],
  };
}

export function toAiReview(report: ReviewReport): AiReview {
  const s = report.toSnapshot();
  return {
    reportId: s.id,
    score: report.score,
    hasBlockingIssues: report.hasBlockingIssues,
    trigger: report.trigger,
    checks: s.checks.map((c) => ({ ...c })),
    createdAt: s.createdAt,
  };
}
