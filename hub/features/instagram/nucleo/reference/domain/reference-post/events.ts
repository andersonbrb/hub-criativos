import { domainEvent, type ReferencePostSelected } from '@sbs/shared-kernel';

/** Contrato publicado: o estúdio cria uma adaptação por mercado ao receber este evento. */
export function referencePostSelected(
  payload: ReferencePostSelected['payload'],
  occurredAt: Date,
): ReferencePostSelected {
  return domainEvent('reference.post_selected', occurredAt, payload);
}
