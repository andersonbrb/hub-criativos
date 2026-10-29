import type { ReviewableContent, ReviewMarketProfile } from '../application';
import type { ReviewAssets, ReviewCheckProps, RuleCheckInput } from '../domain';

export function aMarketProfile(overrides: Partial<ReviewMarketProfile> = {}): ReviewMarketProfile {
  return {
    locale: 'es-419',
    productName: 'San Benito',
    offerUrl: 'https://sanbenito.example.com/oferta',
    forbiddenTerms: ['Sagrado Verso'],
    glossary: [{ source: 'São Bento', target: 'San Benito' }],
    ...overrides,
  };
}

export function reelAssets(): ReviewAssets {
  return {
    format: 'reel',
    videoUrl: 'https://cdn.example.com/reel.mp4',
    coverUrl: 'https://cdn.example.com/cover.jpg',
  };
}

export function carouselAssets(slides = 5): ReviewAssets {
  return {
    format: 'carousel',
    slideUrls: Array.from(
      { length: slides },
      (_, i) => `https://cdn.example.com/slide-${i + 1}.jpg`,
    ),
  };
}

type ContentOverrides = Partial<Omit<ReviewableContent, 'market'>> & {
  market?: Partial<ReviewMarketProfile>;
};

/** Reel em espanhol que passa em todas as regras. */
export function aReviewableContent(overrides: ContentOverrides = {}): ReviewableContent {
  const { market, ...rest } = overrides;
  return {
    contentPieceId: 'piece-1',
    revisionNumber: 1,
    format: 'reel',
    caption: 'Oración de San Benito para proteger tu hogar. Rézala con fe cada noche. 🙏',
    hashtags: ['sanbenito', 'oracion', 'fe'],
    assets: reelAssets(),
    sourceCaption: 'Oração de São Bento para proteger seu lar. Reze com fé toda noite. 🙏',
    market: aMarketProfile(market),
    production: [
      {
        step: 'Edição',
        status: 'approved',
        summary: 'Gancho adaptado; CTA mantido.',
        reviewNotes: 'Legível e no idioma.',
        note: null,
      },
    ],
    reviewReportId: null,
    ...rest,
  };
}

type RuleInputOverrides = Partial<Omit<RuleCheckInput, 'market'>> & {
  market?: Partial<RuleCheckInput['market']>;
};

export function aRuleCheckInput(overrides: RuleInputOverrides = {}): RuleCheckInput {
  const { market, ...rest } = overrides;
  const content = aReviewableContent();
  return {
    format: content.format,
    caption: content.caption,
    hashtags: content.hashtags,
    assets: content.assets,
    market: { ...content.market, ...market },
    ...rest,
  };
}

export function aReviewCheck(overrides: Partial<ReviewCheckProps> = {}): ReviewCheckProps {
  return {
    code: 'caption_length',
    label: 'Tamanho da legenda',
    status: 'pass',
    blocking: false,
    message: 'Legenda dentro do limite.',
    ...overrides,
  };
}
