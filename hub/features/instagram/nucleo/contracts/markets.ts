import { z } from 'zod';
import { AdaptableFormatSchema, IsoDateTime, LocalTimeSchema } from './common';

export const GlossaryTermSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
});
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;

export const MarketStatusSchema = z.enum(['active', 'paused']);

export const MarketSchema = z.object({
  id: z.string(),
  /** Identificador curto e estável, ex.: `es-latam`, `fr`. */
  code: z.string(),
  name: z.string(),
  /** Tag BCP 47, ex.: `es-419`, `fr-FR`. */
  locale: z.string(),
  /** Fuso IANA, ex.: `America/Mexico_City`, `Europe/Paris`. */
  timezone: z.string(),
  /** Nome do produto neste mercado, ex.: `San Benito`, `Saint Benoît`. */
  productName: z.string(),
  offerUrl: z.url(),
  glossary: z.array(GlossaryTermSchema),
  /** Termos que nunca podem aparecer (ex.: nome do produto de outro mercado). */
  forbiddenTerms: z.array(z.string()),
  status: MarketStatusSchema,
  createdAt: IsoDateTime,
});
export type Market = z.infer<typeof MarketSchema>;

export const CreateMarketInputSchema = MarketSchema.pick({
  code: true,
  name: true,
  locale: true,
  timezone: true,
  productName: true,
  offerUrl: true,
  glossary: true,
  forbiddenTerms: true,
});
export type CreateMarketInput = z.infer<typeof CreateMarketInputSchema>;

export const UpdateMarketInputSchema = CreateMarketInputSchema.omit({ code: true })
  .partial()
  .extend({ status: MarketStatusSchema.optional() });
export type UpdateMarketInput = z.infer<typeof UpdateMarketInputSchema>;

export const PostingSlotSchema = z.object({
  localTime: LocalTimeSchema,
  format: AdaptableFormatSchema,
});
export type PostingSlot = z.infer<typeof PostingSlotSchema>;

export const ChannelConnectionStatusSchema = z.enum(['disconnected', 'connected']);

export const ChannelSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  platform: z.literal('instagram'),
  handle: z.string(),
  displayName: z.string(),
  connectionStatus: ChannelConnectionStatusSchema,
  /** Grade diária de publicação, no fuso do mercado. Padrão: 2 reels + 1 carrossel. */
  postingPlan: z.array(PostingSlotSchema),
});
export type Channel = z.infer<typeof ChannelSchema>;

export const CreateChannelInputSchema = z.object({
  marketId: z.string(),
  handle: z.string().regex(/^[a-zA-Z0-9._]{1,30}$/, 'Usuário do Instagram inválido'),
  displayName: z.string().min(1),
  postingPlan: z.array(PostingSlotSchema).min(1).max(10).optional(),
});
export type CreateChannelInput = z.infer<typeof CreateChannelInputSchema>;

export const UpdatePostingPlanInputSchema = z.object({
  postingPlan: z.array(PostingSlotSchema).min(1).max(10),
});
export type UpdatePostingPlanInput = z.infer<typeof UpdatePostingPlanInputSchema>;
