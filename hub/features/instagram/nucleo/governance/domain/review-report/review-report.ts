import { AggregateRoot, ContentPieceId, ReviewReportId } from '@sbs/shared-kernel';
import { GovernanceErrors } from '../errors';
import { automatedReviewCompleted, captionEditReviewed } from './events';
import { ReviewCheck, type ReviewCheckProps } from './review-check';

/**
 * O que originou o relatório: a produção de uma revisão, ou a edição da legenda pelo revisor
 * humano (mesma revisão, novo relatório).
 */
export const REVIEW_TRIGGERS = ['production', 'caption_edit'] as const;
export type ReviewTrigger = (typeof REVIEW_TRIGGERS)[number];

export interface ReviewReportSnapshot {
  id: string;
  version: number;
  contentPieceId: string;
  revisionNumber: number;
  /** Ausente em relatórios anteriores à revisão da legenda editada (eram todos da produção). */
  trigger?: ReviewTrigger;
  checks: ReviewCheckProps[];
  createdAt: string;
}

const MAX_SCORE = 100;
const FAIL_PENALTY = 25;
const WARN_PENALTY = 10;

/**
 * Resultado da revisão automática (regras + IA) de uma revisão de uma peça.
 * É imutável: uma nova revisão da peça ganha um novo relatório, e a legenda editada pelo
 * revisor também (mesmo `revisionNumber`, `trigger: 'caption_edit'`).
 */
export class ReviewReport extends AggregateRoot<ReviewReportId> {
  private constructor(
    id: ReviewReportId,
    version: number,
    readonly contentPieceId: ContentPieceId,
    readonly revisionNumber: number,
    readonly trigger: ReviewTrigger,
    readonly checks: readonly ReviewCheck[],
    readonly createdAt: Date,
  ) {
    super(id, version);
  }

  static create(
    id: ReviewReportId,
    props: {
      contentPieceId: ContentPieceId;
      revisionNumber: number;
      checks: ReviewCheck[];
      /** Padrão: `production`. */
      trigger?: ReviewTrigger;
    },
    now: Date,
  ): ReviewReport {
    const trigger = props.trigger ?? 'production';
    const report = new ReviewReport(
      id,
      0,
      props.contentPieceId,
      requireRevisionNumber(props.revisionNumber),
      trigger,
      requireChecks(props.checks),
      now,
    );
    const payload = {
      reviewReportId: id,
      contentPieceId: props.contentPieceId,
      revisionNumber: report.revisionNumber,
      score: report.score,
      hasBlockingIssues: report.hasBlockingIssues,
    };
    // Só o relatório da produção libera a peça; o da edição volta junto com a própria edição.
    report.record(
      trigger === 'production'
        ? automatedReviewCompleted(now, payload)
        : captionEditReviewed(now, payload),
    );
    return report;
  }

  static fromSnapshot(s: ReviewReportSnapshot): ReviewReport {
    return new ReviewReport(
      ReviewReportId(s.id),
      s.version,
      ContentPieceId(s.contentPieceId),
      s.revisionNumber,
      s.trigger ?? 'production',
      s.checks.map((c) => ReviewCheck.of(c)),
      new Date(s.createdAt),
    );
  }

  /** 100 − 25 por reprovação − 10 por aviso, nunca abaixo de 0. */
  get score(): number {
    const fails = this.checks.filter((c) => c.status === 'fail').length;
    const warns = this.checks.filter((c) => c.status === 'warn').length;
    return Math.max(0, MAX_SCORE - FAIL_PENALTY * fails - WARN_PENALTY * warns);
  }

  /** Existe reprovação bloqueante: o revisor humano não pode aprovar esta revisão. */
  get hasBlockingIssues(): boolean {
    return this.checks.some((c) => c.isBlockingIssue);
  }

  toSnapshot(): ReviewReportSnapshot {
    return {
      id: this.id,
      version: this.version,
      contentPieceId: this.contentPieceId,
      revisionNumber: this.revisionNumber,
      trigger: this.trigger,
      checks: this.checks.map((c) => c.toProps()),
      createdAt: this.createdAt.toISOString(),
    };
  }
}

function requireRevisionNumber(revisionNumber: number): number {
  if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
    throw GovernanceErrors.invalidRevisionNumber(revisionNumber);
  }
  return revisionNumber;
}

function requireChecks(checks: ReviewCheck[]): ReviewCheck[] {
  if (checks.length === 0) throw GovernanceErrors.emptyReviewReport();
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.code)) throw GovernanceErrors.duplicateReviewCheck(check.code);
    seen.add(check.code);
  }
  return [...checks];
}
