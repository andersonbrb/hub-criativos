import { z } from 'zod';
import { IsoDateTime } from './common';
import { PublicationSchema } from './publishing';

export const ActivitySchema = z.object({
  at: IsoDateTime,
  message: z.string(),
  contentPieceId: z.string().nullable(),
});
export type Activity = z.infer<typeof ActivitySchema>;

export const DashboardSchema = z.object({
  counts: z.object({
    awaitingApproval: z.number().int(),
    inProduction: z.number().int(),
    changesRequested: z.number().int(),
    scheduledToday: z.number().int(),
    publishedToday: z.number().int(),
    failed: z.number().int(),
  }),
  nextPublications: z.array(PublicationSchema),
  perMarket: z.array(
    z.object({
      marketId: z.string(),
      name: z.string(),
      awaitingApproval: z.number().int(),
      scheduledToday: z.number().int(),
      publishedLast7Days: z.number().int(),
    }),
  ),
  recentActivity: z.array(ActivitySchema),
});
export type Dashboard = z.infer<typeof DashboardSchema>;
