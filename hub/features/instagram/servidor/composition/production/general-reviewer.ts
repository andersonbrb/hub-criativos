import type { GeneralReviewer, GeneralReviewInput } from '@sbs/governance';
import { downloadImage } from './media-helpers';
import type { ProductionTools } from './translation-stages';
import { videoFrames } from './video-frames';

/** Slides mostrados ao revisor geral (o resto do carrossel segue o mesmo padrão). */
const MAX_SLIDES = 10;

/**
 * Revisor geral com o Claude: monta as imagens da peça final (capa e quadros do vídeo, ou os
 * slides) e pede o parecer sobre a peça inteira. Sem IA conectada, não opina (`null`).
 */
export class ProductionGeneralReviewer implements GeneralReviewer {
  constructor(private readonly tools: ProductionTools) {}

  async review(input: GeneralReviewInput) {
    const judge = await this.tools.judge();
    if (!judge) return null;
    const verdict = await judge.reviewWhole({
      format: input.format,
      locale: input.market.locale,
      productName: input.market.productName,
      caption: input.caption,
      hashtags: input.hashtags,
      sourceCaption: input.sourceCaption,
      production: input.production,
      images: await this.images(input),
    });
    return {
      code: 'general_review',
      label: 'Revisor geral',
      status: verdict.status,
      blocking: false,
      message: verdict.message,
    };
  }

  /** Imagens que o revisor vê; as que não abrem ficam de fora. */
  private async images(input: GeneralReviewInput) {
    const assets = input.assets;
    if (!assets) return [];
    const images: { label: string; data: string; mediaType: string }[] = [];
    const add = async (label: string, url: string) => {
      try {
        images.push({ label, ...(await downloadImage(this.tools.fetch, url)) });
      } catch {
        // Imagem que não abre: o revisor segue com as demais.
      }
    };

    if (assets.format === 'carousel') {
      for (const [index, url] of assets.slideUrls.slice(0, MAX_SLIDES).entries()) {
        await add(`Slide ${index + 1}`, url);
      }
      return images;
    }

    if (assets.coverUrl) await add('Capa', assets.coverUrl);
    const renderer = this.tools.renderer;
    if (!renderer) return images;
    try {
      const frames = await videoFrames(renderer, assets.videoUrl, [0.15, 0.5, 0.9]);
      for (const frame of frames) {
        images.push({
          label: `Vídeo em ${frame.second.toFixed(1)} s`,
          data: frame.data,
          mediaType: frame.mediaType,
        });
      }
    } catch {
      // Sem quadros do vídeo (editor indisponível): o revisor vê a capa e o relatório.
    }
    return images;
  }
}
