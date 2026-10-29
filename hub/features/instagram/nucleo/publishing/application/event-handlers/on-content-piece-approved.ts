import type { ContentPieceApproved, EventHandler } from '@sbs/shared-kernel';
import type { SchedulePublication } from '../use-cases/schedule-publication';

/** Liga `studio.content_piece_approved` ao agendamento (assinado no composition root). */
export function onContentPieceApproved(
  schedule: SchedulePublication,
): EventHandler<ContentPieceApproved> {
  return async (event) => {
    await schedule.execute({
      contentPieceId: event.payload.contentPieceId,
      channelId: event.payload.channelId,
      format: event.payload.format,
    });
  };
}
