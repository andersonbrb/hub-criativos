import { z } from 'zod';

export const IsoDateTime = z.iso.datetime({ offset: true });

export const ContentFormatSchema = z.enum(['reel', 'carousel', 'image', 'story']);
export type ContentFormat = z.infer<typeof ContentFormatSchema>;

export const AdaptableFormatSchema = z.enum(['reel', 'carousel']);
export type AdaptableFormat = z.infer<typeof AdaptableFormatSchema>;

/** Hora local no fuso do mercado, formato 24h `HH:mm`. */
export const LocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use o formato HH:mm');

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const UserRoleSchema = z.enum(['admin', 'reviewer']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.email(),
  role: UserRoleSchema,
});
export type User = z.infer<typeof UserSchema>;

/** Escolhas de produção feitas ao selecionar um post (quem traduz o reel e como). */
export const ProductionOptionsSchema = z.object({
  videoTranslation: z.enum(['auto', 'heygen', 'elevenlabs']),
  heygenMode: z.enum(['speed', 'precision']),
  /** Modelo da FLORA para as imagens (`null`: padrão da plataforma). */
  imageModel: z.string().max(100).nullable(),
});
export type ProductionOptions = z.infer<typeof ProductionOptionsSchema>;
