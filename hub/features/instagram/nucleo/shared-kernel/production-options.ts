/**
 * Escolhas de produção feitas ao selecionar um post (linguagem publicada: viaja no evento
 * `reference.post_selected` até o estúdio).
 */
export type VideoTranslationTool = 'auto' | 'heygen' | 'elevenlabs';
export type HeygenMode = 'speed' | 'precision';

export interface ProductionOptions {
  /**
   * Quem traduz o reel: `heygen` (voz + sincronia labial, para quem fala na câmera),
   * `elevenlabs` (dublagem de voz, para narração sem rosto) ou `auto` (a plataforma decide).
   */
  videoTranslation: VideoTranslationTool;
  /** Modo do HeyGen: `speed` (rápido) ou `precision` (sincronia labial mais fiel). */
  heygenMode: HeygenMode;
  /**
   * Modelo da FLORA para adaptar as imagens (slides do carrossel e capa do reel), um `model_id`
   * de edição de imagem. `null`: o padrão da plataforma.
   */
  imageModel: string | null;
}

export const DEFAULT_PRODUCTION_OPTIONS: Readonly<ProductionOptions> = {
  videoTranslation: 'auto',
  heygenMode: 'speed',
  imageModel: null,
};

const TOOLS: readonly VideoTranslationTool[] = ['auto', 'heygen', 'elevenlabs'];
const MODES: readonly HeygenMode[] = ['speed', 'precision'];
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,99}$/i;

/** Completa com os padrões e descarta valores desconhecidos. */
export function normalizeProductionOptions(
  options: Partial<ProductionOptions> | null | undefined,
): ProductionOptions {
  return {
    videoTranslation: TOOLS.includes(options?.videoTranslation as VideoTranslationTool)
      ? (options!.videoTranslation as VideoTranslationTool)
      : DEFAULT_PRODUCTION_OPTIONS.videoTranslation,
    heygenMode: MODES.includes(options?.heygenMode as HeygenMode)
      ? (options!.heygenMode as HeygenMode)
      : DEFAULT_PRODUCTION_OPTIONS.heygenMode,
    imageModel:
      typeof options?.imageModel === 'string' && MODEL_ID.test(options.imageModel)
        ? options.imageModel
        : null,
  };
}
