import {
  ContentPieceId,
  ReviewReportId,
  type Clock,
  type ContentPieceProduced,
  type EventBus,
  type IdGenerator,
} from '@sbs/shared-kernel';
import {
  ReviewCheck,
  ReviewReport,
  RuleBasedChecks,
  type ReviewReportRepository,
} from '../../domain';
import { describeError, runAiChecks } from '../ai-checks';
import type { ContentForReview, ReviewableContent } from '../ports/content-for-review';
import type { ContentReviewer } from '../ports/content-reviewer';
import { GENERAL_REVIEW_CODE, type GeneralReviewer } from '../ports/general-reviewer';

export type RunAutomatedReviewInput = Pick<
  ContentPieceProduced['payload'],
  'contentPieceId' | 'revisionNumber'
>;

/**
 * Revisa automaticamente uma revisão recém-produzida (regras + IA) e publica
 * `governance.automated_review_completed`.
 *
 * Devolve o relatório criado, ou `null` quando não há nada a fazer: a revisão já foi
 * revisada (evento reentregue) ou a peça já está numa revisão mais nova (evento atrasado).
 */
export class RunAutomatedReview {
  private readonly rules = new RuleBasedChecks();

  constructor(
    private readonly reports: ReviewReportRepository,
    private readonly content: ContentForReview,
    private readonly reviewer: ContentReviewer,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus,
    private readonly generalReviewer: GeneralReviewer | null = null,
  ) {}

  async execute(input: RunAutomatedReviewInput): Promise<ReviewReport | null> {
    const contentPieceId = ContentPieceId(input.contentPieceId);
    if (await this.reports.findByRevision(contentPieceId, input.revisionNumber)) return null;

    const content = await this.content.get(contentPieceId);
    // A revisão nova terá seu próprio evento; revisar a antiga só confundiria o studio.
    if (content.revisionNumber !== input.revisionNumber) return null;

    const ruleChecks = this.rules.run(content);
    const checks = [...ruleChecks, ...(await runAiChecks(this.reviewer, content, ruleChecks))];
    const general = await this.generalCheck(content);
    if (general) checks.push(general);
    const report = ReviewReport.create(
      ReviewReportId(this.ids.next()),
      { contentPieceId, revisionNumber: input.revisionNumber, checks },
      this.clock.now(),
    );
    await this.reports.save(report);
    await this.events.publish(report.pullEvents());
    return report;
  }

  /** Por último, o revisor geral olha a peça inteira; falha vira aviso, ausência não aparece. */
  private async generalCheck(content: ReviewableContent): Promise<ReviewCheck | null> {
    if (!this.generalReviewer) return null;
    try {
      const props = await this.generalReviewer.review({
        format: content.format,
        caption: content.caption,
        hashtags: content.hashtags,
        sourceCaption: content.sourceCaption,
        market: content.market,
        assets: content.assets,
        production: content.production,
      });
      // O revisor geral orienta a decisão humana; não bloqueia a aprovação.
      return props
        ? ReviewCheck.of({ ...props, code: GENERAL_REVIEW_CODE, blocking: false })
        : null;
    } catch (error) {
      return ReviewCheck.warn(
        GENERAL_REVIEW_CODE,
        'Revisor geral',
        `O revisor geral não respondeu (${describeError(error)}). Confira a mídia e a legenda juntas antes de aprovar.`,
      );
    }
  }
}
