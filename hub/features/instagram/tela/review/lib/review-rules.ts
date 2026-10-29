import type { ContentPiece, ReviewCheck, Revision } from '@sbs/contracts';

/** Mínimo exigido pelo domínio para sugestão e motivo (após `trim`). */
export const MIN_NOTE_LENGTH = 3;

/** Limite do Instagram para legenda + hashtags. */
export const CAPTION_LIMIT = 2200;
export const HASHTAG_LIMIT = 30;

export function blockingChecks(revision: Revision): ReviewCheck[] {
  return (revision.aiReview?.checks ?? []).filter(
    (check) => check.blocking && check.status === 'fail',
  );
}

/**
 * Motivo pelo qual "Aprovar" está indisponível, ou `null` se pode aprovar.
 * Espelha as regras do domínio (`blocking_issues_unresolved`, assets ausentes).
 */
export function approvalBlocker(piece: ContentPiece): string | null {
  if (piece.status !== 'awaiting_approval') {
    return 'Só é possível aprovar peças que estão aguardando aprovação.';
  }
  const revision = piece.currentRevision;
  if (!revision.assets) {
    return 'Esta revisão ainda não tem mídia. Peça ajustes para gerar a mídia.';
  }
  const blocking = blockingChecks(revision);
  if (blocking.length > 0 || revision.aiReview?.hasBlockingIssues) {
    const names = blocking.map((check) => check.label).join(', ');
    const count = Math.max(blocking.length, 1);
    const noun = count === 1 ? 'problema bloqueante' : 'problemas bloqueantes';
    return `A revisão automática encontrou ${count} ${noun}${names ? ` (${names})` : ''}. Peça ajustes para corrigir antes de aprovar.`;
  }
  return null;
}

const checkOrder: Record<ReviewCheck['status'], number> = { fail: 0, warn: 1, pass: 2 };

/** Falhas bloqueantes primeiro, depois falhas, avisos e aprovadas. */
export function sortChecks(checks: readonly ReviewCheck[]): ReviewCheck[] {
  return [...checks].sort((a, b) => {
    if (a.blocking !== b.blocking && a.status === 'fail' && b.status === 'fail') {
      return a.blocking ? -1 : 1;
    }
    const byStatus = checkOrder[a.status] - checkOrder[b.status];
    if (byStatus !== 0) return byStatus;
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    return 0;
  });
}

export function countChecks(checks: readonly ReviewCheck[]) {
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warn: checks.filter((check) => check.status === 'warn').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  };
}

/** "#fe #SanBenito, oração" vira ["#fe", "#SanBenito", "#oração"] (sem repetidos). */
export function parseHashtags(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const tag = raw.trim().replace(/^#+/, '');
    if (!tag) continue;
    const normalized = `#${tag}`;
    const key = normalized.toLocaleLowerCase('pt-BR');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

export function formatHashtags(hashtags: readonly string[]): string {
  return hashtags.map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)).join(' ');
}

/** Tamanho final do texto publicado: legenda, linha em branco e hashtags. */
export function publishedLength(caption: string, hashtags: readonly string[]): number {
  if (hashtags.length === 0) return caption.length;
  return caption.length + 2 + formatHashtags(hashtags).length;
}

/** Valida sugestão/motivo. Devolve a mensagem de erro ou `null`. */
export function validateNote(text: string, kind: 'suggestion' | 'reason'): string | null {
  if (text.trim().length >= MIN_NOTE_LENGTH) return null;
  return kind === 'suggestion'
    ? 'Escreva o motivo para voltar para a edição (pelo menos 3 caracteres).'
    : 'Escreva o motivo da reprovação (pelo menos 3 caracteres).';
}
