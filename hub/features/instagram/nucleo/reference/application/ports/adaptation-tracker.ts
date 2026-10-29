/**
 * Quantas adaptações de um post ainda estão em andamento (nem reprovadas nem publicadas).
 * Implementada no composition root lendo o estúdio.
 */
export interface AdaptationTracker {
  countOpen(referencePostId: string): Promise<number>;
}
