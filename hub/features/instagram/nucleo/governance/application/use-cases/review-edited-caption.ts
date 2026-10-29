import {
  ContentPieceId,
  ReviewReportId,
  type Clock,
  type EventBus,
  type IdGenerator,
} from '@sbs/shared-kernel';
import {
  GovernanceErrors,
  ReviewCheck,
  ReviewReport,
  RuleBasedChecks,
  type ReviewReportRepository,
} from '../../domain';
import { AI_REVIEWER_UNAVAILABLE, runAiChecks } from '../ai-checks';
import type { ContentForReview, ReviewableContent } from '../ports/content-for-review';
import type { ContentReviewer } from '../ports/content-reviewer';
import { GENERAL_REVIEW_CODE } from '../ports/general-reviewer';

export interface ReviewEditedCaptionInput {
  contentPieceId: string;
  caption: string;
  hashtags: string[];
}

export interface ReviewEditedCaptionOptions {
  /** Quanto esperar o revisor de IA antes de seguir com um aviso (o revisor está esperando). */
  aiTimeoutMs?: number;
}

const DEFAULT_AI_TIMEOUT_MS = 90_000;
const PREVIOUS_CAPTION_NOTE = 'Parecer sobre a legenda anterior à edição:';

/**
 * Revisa de novo a legenda editada pelo revisor humano, com o mesmo critério da legenda gerada:
 * regras (falha bloqueante recusa a edição) e revisor de IA (falha bloqueante fica no relatório
 * e impede a aprovação, como na produção). Grava um novo relatório da mesma revisão
 * (`trigger: 'caption_edit'`) e publica `governance.caption_edit_reviewed`.
 *
 * Custo: se o texto só mudou em espaços e quebras de linha, reaproveita as checagens de IA do
 * relatório atual em vez de chamar a IA de novo (a não ser que a IA tenha falhado nele).
 * O parecer do revisor geral (mídia + legenda) não é refeito: segue o anterior, sinalizado.
 */
export class ReviewEditedCaption {
  private readonly rules = new RuleBasedChecks();
  private readonly aiTimeoutMs: number;

  constructor(
    private readonly reports: ReviewReportRepository,
    private readonly content: ContentForReview,
    private readonly reviewer: ContentReviewer,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly events: EventBus,
    options: ReviewEditedCaptionOptions = {},
  ) {
    this.aiTimeoutMs = options.aiTimeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
  }

  async execute(input: ReviewEditedCaptionInput): Promise<ReviewReport> {
    const current = await this.content.get(input.contentPieceId);
    const edited: ReviewableContent = {
      ...current,
      caption: input.caption.trim(),
      hashtags: [...input.hashtags],
    };

    const ruleChecks = this.rules.run(edited);
    const blocking = ruleChecks.filter((check) => check.isBlockingIssue);
    if (blocking.length > 0) {
      throw GovernanceErrors.captionBlockedByRules(blocking.map((c) => c.toProps()));
    }

    const previous = current.reviewReportId
      ? await this.reports.findById(ReviewReportId(current.reviewReportId))
      : null;
    const reusable =
      previous && sameText(current, edited) ? reusableAiChecks(previous, ruleChecks) : null;
    const aiChecks =
      reusable ?? (await runAiChecks(this.reviewer, edited, ruleChecks, this.aiTimeoutMs));

    const checks = [...ruleChecks, ...aiChecks];
    const general = previous?.checks.find((c) => c.code === GENERAL_REVIEW_CODE);
    if (general) checks.push(reusable ? general : markAsPrevious(general));

    const report = ReviewReport.create(
      ReviewReportId(this.ids.next()),
      {
        contentPieceId: ContentPieceId(input.contentPieceId),
        revisionNumber: current.revisionNumber,
        checks,
        trigger: 'caption_edit',
      },
      this.clock.now(),
    );
    await this.reports.save(report);
    await this.events.publish(report.pullEvents());
    return report;
  }
}

/** Mesmo texto para o leitor: só espaços, quebras de linha e o `#` das hashtags mudaram. */
function sameText(a: Pick<ReviewableContent, 'caption' | 'hashtags'>, b: typeof a): boolean {
  const caption = (text: string) => text.replace(/\s+/g, ' ').trim();
  const tags = (list: readonly string[]) =>
    list.map((t) => t.trim().replace(/^#+/, '').toLocaleLowerCase()).join(' ');
  return caption(a.caption) === caption(b.caption) && tags(a.hashtags) === tags(b.hashtags);
}

/** As checagens de IA do relatório anterior, se a IA respondeu nele; senão `null` (chamar de novo). */
function reusableAiChecks(
  previous: ReviewReport,
  ruleChecks: readonly ReviewCheck[],
): ReviewCheck[] | null {
  const ruleCodes = new Set(ruleChecks.map((c) => c.code));
  const ai = previous.checks.filter(
    (c) => !ruleCodes.has(c.code) && c.code !== GENERAL_REVIEW_CODE,
  );
  if (ai.length === 0 || ai.some((c) => c.code === AI_REVIEWER_UNAVAILABLE)) return null;
  return ai;
}

function markAsPrevious(check: ReviewCheck): ReviewCheck {
  if (check.message.startsWith(PREVIOUS_CAPTION_NOTE)) return check;
  return ReviewCheck.of({
    ...check.toProps(),
    message: `${PREVIOUS_CAPTION_NOTE} ${check.message}`,
  });
}
