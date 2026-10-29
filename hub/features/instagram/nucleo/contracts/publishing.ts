import { z } from 'zod';
import { AdaptableFormatSchema, IsoDateTime } from './common';

export const PublicationStatusSchema = z.enum([
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
]);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const PublicationSchema = z.object({
  id: z.string(),
  contentPieceId: z.string(),
  channelId: z.string(),
  marketId: z.string(),
  format: AdaptableFormatSchema,
  scheduledAt: IsoDateTime,
  status: PublicationStatusSchema,
  attempts: z.number().int().nonnegative(),
  permalink: z.url().nullable(),
  lastError: z.string().nullable(),
  publishedAt: IsoDateTime.nullable(),
});
export type Publication = z.infer<typeof PublicationSchema>;

export const PublicationFilterSchema = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  channelId: z.string().optional(),
});
export type PublicationFilter = z.infer<typeof PublicationFilterSchema>;

export const RescheduleInputSchema = z.object({
  scheduledAt: IsoDateTime,
});
export type RescheduleInput = z.infer<typeof RescheduleInputSchema>;
