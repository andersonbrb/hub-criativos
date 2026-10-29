import { z } from 'zod';

/** Quantidade de registros de demonstração (feed de exemplo e o que derivou dele). */
export const DemoDataSummarySchema = z.object({
  posts: z.number().int().nonnegative(),
  adaptations: z.number().int().nonnegative(),
  reviews: z.number().int().nonnegative(),
  publications: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
});
export type DemoDataSummary = z.infer<typeof DemoDataSummarySchema>;
