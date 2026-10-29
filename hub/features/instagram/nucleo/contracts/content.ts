import { z } from 'zod';
import { AdaptableFormatSchema, IsoDateTime, ProductionOptionsSchema } from './common';

export const ContentPieceStatusSchema = z.enum([
  'queued',
  'producing',
  'ai_review',
  'awaiting_approval',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'rejected',
  'failed',
]);
export type ContentPieceStatus = z.infer<typeof ContentPieceStatusSchema>;

export const ContentAssetsSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('reel'), videoUrl: z.url(), coverUrl: z.url().nullable() }),
  z.object({ format: z.literal('carousel'), slideUrls: z.array(z.url()).min(1) }),
]);
export type ContentAssets = z.infer<typeof ContentAssetsSchema>;

export const ReviewCheckSchema = z.object({
  code: z.string(),
  label: z.string(),
  status: z.enum(['pass', 'warn', 'fail']),
  blocking: z.boolean(),
  message: z.string(),
});
export type ReviewCheck = z.infer<typeof ReviewCheckSchema>;

export const AiReviewSchema = z.object({
  reportId: z.string(),
  score: z.number().min(0).max(100),
  hasBlockingIssues: z.boolean(),
  /** `caption_edit`: refeita sobre a legenda editada pelo revisor (mesma revisão). */
  trigger: z.enum(['production', 'caption_edit']),
  checks: z.array(ReviewCheckSchema),
  createdAt: IsoDateTime,
});
export type AiReview = z.infer<typeof AiReviewSchema>;

export const ProductionStepKindSchema = z.enum([
  'ingest',
  'subtitle_removal',
  'video_translation',
  'audio',
  'images',
  'editing',
  'caption',
  'creative',
]);
export type ProductionStepKind = z.infer<typeof ProductionStepKindSchema>;

/** Uma etapa da produção: o que o agente especialista fez e o parecer do revisor, por tentativa. */
export const ProductionStepSchema = z.object({
  kind: ProductionStepKindSchema,
  status: z.enum(['running', 'approved', 'rejected', 'skipped', 'failed']),
  /** Por que a etapa foi pulada (ex.: integração não conectada). */
  note: z.string().nullable(),
  attempts: z.array(
    z.object({
      number: z.number().int().positive(),
      startedAt: IsoDateTime,
      finishedAt: IsoDateTime.nullable(),
      summary: z.string().nullable(),
      outputUrls: z.array(z.string()),
      review: z.object({ approved: z.boolean(), notes: z.string() }).nullable(),
      error: z.string().nullable(),
    }),
  ),
});
export type ProductionStep = z.infer<typeof ProductionStepSchema>;

export const RevisionSchema = z.object({
  number: z.number().int().positive(),
  createdAt: IsoDateTime,
  caption: z.string(),
  hashtags: z.array(z.string()),
  assets: ContentAssetsSchema.nullable(),
  /** Sugestão do revisor que originou esta revisão. */
  requestedChanges: z
    .object({ by: z.string(), suggestion: z.string(), at: IsoDateTime })
    .nullable(),
  aiReview: AiReviewSchema.nullable(),
  /** Etapas da produção desta revisão (especialistas e revisores), em ordem. */
  production: z.array(ProductionStepSchema),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const StatusChangeSchema = z.object({
  from: ContentPieceStatusSchema.nullable(),
  to: ContentPieceStatusSchema,
  at: IsoDateTime,
  by: z.string().nullable(),
  note: z.string().nullable(),
});
export type StatusChange = z.infer<typeof StatusChangeSchema>;

export const ContentSourceSchema = z.object({
  referencePostId: z.string(),
  caption: z.string(),
  permalink: z.url(),
  thumbnailUrl: z.url(),
  mediaUrls: z.array(z.url()),
});
export type ContentSource = z.infer<typeof ContentSourceSchema>;

export const ContentPieceSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  channelId: z.string(),
  format: AdaptableFormatSchema,
  status: ContentPieceStatusSchema,
  source: ContentSourceSchema,
  productionOptions: ProductionOptionsSchema,
  currentRevision: RevisionSchema,
  revisions: z.array(RevisionSchema),
  history: z.array(StatusChangeSchema),
  failureReason: z.string().nullable(),
  publication: z
    .object({
      id: z.string(),
      scheduledAt: IsoDateTime,
      status: z.enum(['scheduled', 'published']),
      permalink: z.url().nullable(),
    })
    .nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ContentPiece = z.infer<typeof ContentPieceSchema>;

export const ContentPieceSummarySchema = z.object({
  id: z.string(),
  marketId: z.string(),
  channelId: z.string(),
  format: AdaptableFormatSchema,
  status: ContentPieceStatusSchema,
  thumbnailUrl: z.url(),
  captionPreview: z.string(),
  revisionNumber: z.number().int().positive(),
  aiScore: z.number().nullable(),
  hasBlockingIssues: z.boolean().nullable(),
  scheduledAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime,
});
export type ContentPieceSummary = z.infer<typeof ContentPieceSummarySchema>;

export const ContentPieceFilterSchema = z.object({
  status: ContentPieceStatusSchema.optional(),
  marketId: z.string().optional(),
});
export type ContentPieceFilter = z.infer<typeof ContentPieceFilterSchema>;

/** Decisão do revisor (social media) sobre a revisão atual. */
export const DecisionInputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(3) }),
  z.object({ action: z.literal('request_changes'), suggestion: z.string().trim().min(3) }),
]);
export type DecisionInput = z.infer<typeof DecisionInputSchema>;

export const EditCaptionInputSchema = z.object({
  caption: z.string().max(2200),
  hashtags: z.array(z.string().regex(/^#?[\p{L}\p{N}_]+$/u, 'Hashtag inválida')).max(30),
});
export type EditCaptionInput = z.infer<typeof EditCaptionInputSchema>;
