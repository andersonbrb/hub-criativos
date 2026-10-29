import { ReviewCheck } from '../domain';
import type { ReviewableContent } from './ports/content-for-review';
import type { ContentReviewer } from './ports/content-reviewer';

export const AI_REVIEWER_UNAVAILABLE = 'ai_reviewer_unavailable';

/**
 * Checagens do revisor de IA sobre a legenda da peça, o mesmo critério para a legenda gerada e
 * para a editada pelo revisor. Falha do revisor (ou resposta inválida, ou demora além de
 * `timeoutMs`) não derruba a revisão: vira um aviso.
 */
export async function runAiChecks(
  reviewer: ContentReviewer,
  content: ReviewableContent,
  ruleChecks: readonly ReviewCheck[],
  timeoutMs: number | null = null,
): Promise<ReviewCheck[]> {
  try {
    const call = reviewer.review({
      format: content.format,
      caption: content.caption,
      hashtags: content.hashtags,
      sourceCaption: content.sourceCaption,
      market: content.market,
    });
    const raw = timeoutMs === null ? await call : await withTimeout(call, timeoutMs);
    const checks = raw.map((props) => ReviewCheck.of(props));
    const codes = new Set(ruleChecks.map((c) => c.code));
    for (const check of checks) {
      if (codes.has(check.code)) throw new Error(`checagem "${check.code}" repetida`);
      codes.add(check.code);
    }
    return checks;
  } catch (error) {
    return [
      ReviewCheck.warn(
        AI_REVIEWER_UNAVAILABLE,
        'Revisor de IA',
        `O revisor de IA não respondeu (${describeError(error)}). Confira tradução, coerência religiosa, promessas e tom manualmente.`,
      ),
    ];
  }
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim() || 'erro desconhecido';
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`sem resposta em ${Math.round(ms / 1000)} s`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
