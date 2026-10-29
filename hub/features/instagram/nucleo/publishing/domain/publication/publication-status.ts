export const PUBLICATION_STATUSES = [
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** Uma peça só pode ter uma publicação nestes estados (cancelada libera a peça). */
export const ACTIVE_STATUSES: readonly PublicationStatus[] = [
  'scheduled',
  'publishing',
  'published',
  'failed',
];

/** Estados cujo horário ocupa um slot da grade do canal. */
export const SLOT_OCCUPYING_STATUSES: readonly PublicationStatus[] = [
  'scheduled',
  'publishing',
  'published',
];
