import { z } from 'zod';
import { ContentFormatSchema, IsoDateTime, ProductionOptionsSchema } from './common';

export const ReferenceSourceSchema = z.object({
  id: z.string(),
  handle: z.string(),
  locale: z.string(),
  /** Conectada: os posts são lidos na sincronização e entram na seleção automática. */
  connectionStatus: z.enum(['disconnected', 'connected']),
  lastSyncedAt: IsoDateTime.nullable(),
  /** Posts já importados desta página. */
  postsCount: z.number().int().nonnegative(),
});
export type ReferenceSource = z.infer<typeof ReferenceSourceSchema>;

export const CreateReferenceSourceInputSchema = z.object({
  /** `@usuario`, `usuario` ou o link do perfil no Instagram. */
  handle: z.string().trim().min(1, 'Informe o @ ou o link da página.'),
  connected: z.boolean().optional(),
});
export type CreateReferenceSourceInput = z.infer<typeof CreateReferenceSourceInputSchema>;

export const ReferenceSourceConnectionInputSchema = z.object({ connected: z.boolean() });
export type ReferenceSourceConnectionInput = z.infer<typeof ReferenceSourceConnectionInputSchema>;

/** Corpo opcional de "selecionar post": as escolhas de produção (padrão: automático, rápido). */
export const SelectReferencePostInputSchema = z.object({
  production: ProductionOptionsSchema.partial().optional(),
});
export type SelectReferencePostInput = z.infer<typeof SelectReferencePostInputSchema>;

export const PostMetricsSchema = z.object({
  views: z.number().int().nonnegative(),
  reach: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative(),
});
export type PostMetrics = z.infer<typeof PostMetricsSchema>;

export const ReferencePostStatusSchema = z.enum(['new', 'selected', 'ignored']);
export type ReferencePostStatus = z.infer<typeof ReferencePostStatusSchema>;

export const ReferencePostSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  externalId: z.string(),
  format: ContentFormatSchema,
  caption: z.string(),
  permalink: z.url(),
  thumbnailUrl: z.url(),
  mediaUrls: z.array(z.url()),
  publishedAt: IsoDateTime,
  metrics: PostMetricsSchema,
  /**
   * Engajamento ponderado (curtidas + 2·comentários + 3·salvamentos + 4·compartilhamentos).
   * Com alcance (conta como dona): por mil pessoas alcançadas. Sem alcance (perfil público): absoluto.
   */
  performanceScore: z.number(),
  status: ReferencePostStatusSchema,
  selectedAt: IsoDateTime.nullable(),
  adaptationsCount: z.number().int().nonnegative(),
  /**
   * Adaptações ainda em andamento (nem reprovadas nem publicadas). Com 0, o post pode ser
   * selecionado de novo para uma nova rodada.
   */
  openAdaptationsCount: z.number().int().nonnegative(),
});
export type ReferencePost = z.infer<typeof ReferencePostSchema>;

export const SyncResultSchema = z.object({
  /** Páginas lidas (só as conectadas). */
  sources: z.number().int(),
  imported: z.number().int(),
  updated: z.number().int(),
});
export type SyncResult = z.infer<typeof SyncResultSchema>;

export const SelectTopResultSchema = z.object({
  selected: z.array(z.string()),
});
export type SelectTopResult = z.infer<typeof SelectTopResultSchema>;
