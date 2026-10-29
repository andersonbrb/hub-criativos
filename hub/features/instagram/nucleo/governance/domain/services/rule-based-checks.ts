import { composePublishedCaption, type AdaptableFormat } from '@sbs/shared-kernel';
import { ReviewCheck } from '../review-report/review-check';
import { containsTerm, hashtagContainsTerm } from './text-matching';

export type ReviewAssets =
  | { format: 'reel'; videoUrl: string; coverUrl: string | null }
  | { format: 'carousel'; slideUrls: string[] };

export interface RuleCheckMarket {
  productName: string;
  offerUrl: string;
  forbiddenTerms: readonly string[];
  glossary: readonly { source: string; target: string }[];
}

export interface RuleCheckInput {
  format: AdaptableFormat;
  caption: string;
  hashtags: readonly string[];
  assets: ReviewAssets | null;
  market: RuleCheckMarket;
}

/** Limites do Instagram e da operação. */
export const CAPTION_MAX_LENGTH = 2200;
export const HASHTAG_SOFT_LIMIT = 10;
export const HASHTAG_HARD_LIMIT = 30;
export const CAROUSEL_MIN_SLIDES = 2;
export const CAROUSEL_MAX_SLIDES = 20;

export const RULE_CHECK_LABELS = {
  caption_length: 'Tamanho da legenda',
  hashtag_count: 'Quantidade de hashtags',
  forbidden_terms: 'Termos proibidos',
  product_mention: 'Menção ao produto',
  assets_present: 'Mídia da peça',
  ai_label: 'Rótulo de IA',
} as const;

export type RuleCheckCode = keyof typeof RULE_CHECK_LABELS;

/**
 * Checagens determinísticas, baratas e sem IA. Rodam antes do revisor de IA e pegam o que
 * não depende de interpretação: limites do Instagram, termos proibidos do mercado, mídia.
 */
export class RuleBasedChecks {
  run(input: RuleCheckInput): ReviewCheck[] {
    const checks = [
      this.captionLength(input),
      this.hashtagCount(input),
      this.forbiddenTerms(input),
      this.productMention(input),
      this.assetsPresent(input),
    ];
    if (input.format === 'reel') checks.push(this.aiLabel());
    return checks;
  }

  private captionLength({ caption, hashtags }: RuleCheckInput): ReviewCheck {
    const code = 'caption_length';
    const label = RULE_CHECK_LABELS[code];
    const length = publishedCaptionLength(caption, hashtags);
    if (length > CAPTION_MAX_LENGTH) {
      return ReviewCheck.fail(
        code,
        label,
        `Legenda com hashtags tem ${length} caracteres; o Instagram aceita no máximo ${CAPTION_MAX_LENGTH}. Corte ${length - CAPTION_MAX_LENGTH}.`,
      );
    }
    return ReviewCheck.pass(
      code,
      label,
      `Legenda com hashtags tem ${length} de ${CAPTION_MAX_LENGTH} caracteres.`,
    );
  }

  private hashtagCount({ hashtags }: RuleCheckInput): ReviewCheck {
    const code = 'hashtag_count';
    const label = RULE_CHECK_LABELS[code];
    const count = hashtags.length;
    if (count > HASHTAG_HARD_LIMIT) {
      return ReviewCheck.fail(
        code,
        label,
        `${count} hashtags; o Instagram aceita no máximo ${HASHTAG_HARD_LIMIT}. Remova ${count - HASHTAG_HARD_LIMIT}.`,
      );
    }
    if (count > HASHTAG_SOFT_LIMIT) {
      return ReviewCheck.warn(
        code,
        label,
        `${count} hashtags. Acima de ${HASHTAG_SOFT_LIMIT} o post tende a parecer spam; prefira as mais relevantes.`,
      );
    }
    return ReviewCheck.pass(code, label, `${count} hashtag(s), dentro do recomendado.`);
  }

  private forbiddenTerms({ caption, hashtags, market }: RuleCheckInput): ReviewCheck {
    const code = 'forbidden_terms';
    const label = RULE_CHECK_LABELS[code];
    if (market.forbiddenTerms.length === 0) {
      return ReviewCheck.pass(code, label, 'O mercado não tem termos proibidos cadastrados.');
    }
    const found = market.forbiddenTerms.filter(
      (term) =>
        containsTerm(caption, term) || hashtags.some((tag) => hashtagContainsTerm(tag, term)),
    );
    if (found.length > 0) {
      return ReviewCheck.fail(
        code,
        label,
        `Termos proibidos neste mercado: ${found.map((t) => `"${t}"`).join(', ')}. Remova-os da legenda e das hashtags.`,
      );
    }
    return ReviewCheck.pass(code, label, 'Nenhum termo proibido na legenda nem nas hashtags.');
  }

  private productMention({ caption, market }: RuleCheckInput): ReviewCheck {
    const code = 'product_mention';
    const label = RULE_CHECK_LABELS[code];
    if (containsTerm(caption, market.productName)) {
      return ReviewCheck.pass(code, label, `A legenda menciona "${market.productName}".`);
    }
    return ReviewCheck.warn(
      code,
      label,
      `A legenda não menciona "${market.productName}", o nome do produto neste mercado.`,
    );
  }

  private assetsPresent({ format, assets }: RuleCheckInput): ReviewCheck {
    const code = 'assets_present';
    const label = RULE_CHECK_LABELS[code];
    if (!assets) {
      return ReviewCheck.fail(code, label, 'A peça ainda não tem mídia (vídeo ou slides).');
    }
    if (assets.format !== format) {
      return ReviewCheck.fail(
        code,
        label,
        `A mídia é de ${formatName(assets.format)}, mas a peça é ${formatName(format)}.`,
      );
    }
    if (assets.format === 'reel') {
      if (!assets.videoUrl.trim()) return ReviewCheck.fail(code, label, 'O reel está sem vídeo.');
      return ReviewCheck.pass(code, label, 'Vídeo do reel presente.');
    }
    const slides = assets.slideUrls.length;
    if (slides < CAROUSEL_MIN_SLIDES || slides > CAROUSEL_MAX_SLIDES) {
      return ReviewCheck.fail(
        code,
        label,
        `O carrossel tem ${slides} slide(s); o Instagram exige de ${CAROUSEL_MIN_SLIDES} a ${CAROUSEL_MAX_SLIDES}.`,
      );
    }
    return ReviewCheck.pass(code, label, `Carrossel com ${slides} slides.`);
  }

  // Ainda não há como verificar o rótulo automaticamente; a checagem lembra o revisor.
  private aiLabel(): ReviewCheck {
    return ReviewCheck.pass(
      'ai_label',
      RULE_CHECK_LABELS.ai_label,
      'Reels adaptados com IA são publicados com o rótulo "Feito com IA" do Instagram.',
    );
  }
}

/** Tamanho da legenda como vai ao ar: texto + linha em branco + hashtags com `#`. */
export function publishedCaptionLength(caption: string, hashtags: readonly string[]): number {
  const published = composePublishedCaption(caption, hashtags);
  // Conta caracteres visíveis (code points), não unidades UTF-16: um emoji conta como 1.
  return [...published].length;
}

function formatName(format: AdaptableFormat): string {
  return format === 'reel' ? 'reel' : 'carrossel';
}
