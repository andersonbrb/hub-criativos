import { z } from 'zod';
import { IsoDateTime } from './common';

export const EditingFontSchema = z.enum([
  'Montserrat',
  'Poppins',
  'Inter',
  'Lora',
  'Playfair Display',
]);
export type EditingFont = z.infer<typeof EditingFontSchema>;

const Guideline = z.string().trim().min(1, 'Escreva as instruções.').max(4000);
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use uma cor no formato #RRGGBB.');

/** Instruções do diretor de edição e de cada especialista de copy. */
export const EditingGuidelinesSchema = z.object({
  principles: Guideline,
  hook: Guideline,
  body: Guideline,
  cta: Guideline,
  headlines: Guideline,
});
export type EditingGuidelines = z.infer<typeof EditingGuidelinesSchema>;

export const EditingStyleSchema = z.object({
  font: EditingFontSchema,
  textColor: HexColor,
  highlightColor: HexColor,
  captionsPosition: z.enum(['bottom', 'middle']),
  showCaptions: z.boolean(),
  showHeadline: z.boolean(),
  showCtaCard: z.boolean(),
});
export type EditingStyle = z.infer<typeof EditingStyleSchema>;

/** Padrão de Edição: o que os agentes de edição seguem e o estilo dos textos na tela. */
export const EditingStandardSchema = z.object({
  guidelines: EditingGuidelinesSchema,
  style: EditingStyleSchema,
  updatedAt: IsoDateTime.nullable(),
  updatedBy: z.string().nullable(),
});
export type EditingStandard = z.infer<typeof EditingStandardSchema>;

export const UpdateEditingStandardInputSchema = z.object({
  guidelines: EditingGuidelinesSchema.partial().optional(),
  style: EditingStyleSchema.partial().optional(),
});
export type UpdateEditingStandardInput = z.infer<typeof UpdateEditingStandardInputSchema>;
