import type { ContentPieceProduced, EventHandler } from '@sbs/shared-kernel';
import type { RunAutomatedReview } from '../use-cases/run-automated-review';

/**
 * Liga `studio.content_piece_produced` à revisão automática. No composition root:
 * `bus.subscribe<ContentPieceProduced>('studio.content_piece_produced', onContentPieceProduced(run))`.
 */
export function onContentPieceProduced(
  runAutomatedReview: RunAutomatedReview,
): EventHandler<ContentPieceProduced> {
  return async (event) => {
    await runAutomatedReview.execute(event.payload);
  };
}
