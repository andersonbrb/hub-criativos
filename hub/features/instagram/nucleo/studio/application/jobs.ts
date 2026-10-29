/** Nomes dos jobs que o Estúdio enfileira; o worker no composition root chama o caso de uso certo. */
export const StudioJobs = {
  produce: 'studio.produce',
} as const;

export interface ProduceJobPayload {
  contentPieceId: string;
}
