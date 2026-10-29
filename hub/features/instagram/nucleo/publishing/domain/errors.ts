import { DomainError } from '@sbs/shared-kernel';
import type { PublicationStatus } from './publication/publication-status';

const ACTION_LABELS: Record<string, string> = {
  reschedule: 'reagendar',
  startPublishing: 'iniciar a publicação de',
  markPublished: 'marcar como publicada',
  markAttemptFailed: 'registrar falha em',
  cancel: 'cancelar',
};

const STATUS_LABELS: Record<PublicationStatus, string> = {
  scheduled: 'agendada',
  publishing: 'publicando',
  published: 'publicada',
  failed: 'com falha',
  cancelled: 'cancelada',
};

export const PublishingErrors = {
  invalidTransition: (from: PublicationStatus, action: string) =>
    new DomainError(
      'invalid_transition',
      `Não é possível ${ACTION_LABELS[action] ?? action} uma publicação ${STATUS_LABELS[from]}.`,
      { from, action },
    ),
  invalidScheduledAt: () =>
    new DomainError('invalid_scheduled_at', 'Data de agendamento inválida.'),
  scheduledAtInPast: (scheduledAt: Date) =>
    new DomainError('scheduled_at_in_past', 'O novo horário precisa estar no futuro.', {
      scheduledAt: scheduledAt.toISOString(),
    }),
  publicationNotDue: (scheduledAt: Date) =>
    new DomainError('publication_not_due', 'A publicação ainda não chegou ao horário agendado.', {
      scheduledAt: scheduledAt.toISOString(),
    }),
  invalidPublishResult: () =>
    new DomainError(
      'invalid_publish_result',
      'A publicação precisa do id da mídia e do link do post no Instagram.',
    ),
  invalidPostingSlot: (localTime: string) =>
    new DomainError('invalid_posting_slot', `Horário da grade inválido: "${localTime}".`, {
      localTime,
    }),
  noSlotAvailable: (format: string, horizonDays: number) =>
    new DomainError(
      'no_slot_available',
      `Não há horário livre de ${format === 'reel' ? 'reel' : 'carrossel'} na grade nos próximos ${horizonDays} dias.`,
      { format, horizonDays },
    ),
};
