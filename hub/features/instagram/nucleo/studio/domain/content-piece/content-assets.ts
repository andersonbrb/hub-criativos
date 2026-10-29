import type { AdaptableFormat } from '@sbs/shared-kernel';
import { StudioErrors } from '../errors';

export interface ReelAssets {
  format: 'reel';
  videoUrl: string;
  coverUrl: string | null;
}

export interface CarouselAssets {
  format: 'carousel';
  slideUrls: string[];
}

/** Mídia final de uma revisão. O formato precisa ser o mesmo da peça. */
export type ContentAssets = ReelAssets | CarouselAssets;

const MAX_CAROUSEL_SLIDES = 20;

/** Valida e devolve uma cópia dos assets, para não compartilhar arrays com quem chamou. */
export function validateAssets(format: AdaptableFormat, assets: ContentAssets): ContentAssets {
  if (assets.format !== format) throw StudioErrors.assetsFormatMismatch(format, assets.format);

  if (assets.format === 'reel') {
    return {
      format: 'reel',
      videoUrl: requireUrl(assets.videoUrl, 'vídeo'),
      coverUrl: assets.coverUrl === null ? null : requireUrl(assets.coverUrl, 'capa'),
    };
  }

  if (assets.slideUrls.length === 0)
    throw StudioErrors.invalidAssets('o carrossel não tem slides.');
  if (assets.slideUrls.length > MAX_CAROUSEL_SLIDES)
    throw StudioErrors.invalidAssets(`o carrossel passa de ${MAX_CAROUSEL_SLIDES} slides.`);
  return { format: 'carousel', slideUrls: assets.slideUrls.map((url) => requireUrl(url, 'slide')) };
}

export function copyAssets(assets: ContentAssets): ContentAssets {
  return assets.format === 'reel' ? { ...assets } : { ...assets, slideUrls: [...assets.slideUrls] };
}

function requireUrl(url: string, what: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw StudioErrors.invalidAssets(`link do ${what} não é uma URL.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw StudioErrors.invalidAssets(`link do ${what} deve ser http(s).`);
  return url;
}
