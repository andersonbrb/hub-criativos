import type { ContentReviewer, ContentReviewInput } from '../../application';
import { normalizeText, type ReviewCheckProps } from '../../domain';

export interface FakeContentReviewerOptions {
  /** Simula o revisor de IA fora do ar: `review` lança este erro. */
  failWith?: Error;
}

/**
 * Promessas de cura/milagre em pt, es e fr, já sem acento e em minúsculas.
 * O revisor real (agente Claude) entende o contexto; aqui basta uma lista fixa.
 */
const MIRACLE_CLAIMS = [
  'cura garantida',
  'cura garantizada',
  'curacion garantizada',
  'guerison garantie',
  'milagre garantido',
  'milagro garantizado',
  'miracle garanti',
  'garantido',
  '100%',
];

/** Revisor de IA determinístico para desenvolvimento e testes. */
export class FakeContentReviewer implements ContentReviewer {
  readonly calls: ContentReviewInput[] = [];

  constructor(private readonly options: FakeContentReviewerOptions = {}) {}

  async review(input: ContentReviewInput): Promise<ReviewCheckProps[]> {
    this.calls.push(input);
    if (this.options.failWith) throw this.options.failWith;

    const text = normalizeText([input.caption, ...input.hashtags].join(' '));
    const claims = MIRACLE_CLAIMS.filter((claim) => text.includes(claim));

    return [
      {
        code: 'translation_fidelity',
        label: 'Fidelidade da tradução',
        status: 'pass',
        blocking: false,
        message: `A legenda em ${input.market.locale} preserva a mensagem da original.`,
      },
      {
        code: 'religious_accuracy',
        label: 'Coerência religiosa',
        status: 'pass',
        blocking: false,
        message: 'Referências a São Bento e à fé estão corretas.',
      },
      claims.length > 0
        ? {
            code: 'forbidden_claims',
            label: 'Promessas proibidas',
            status: 'fail',
            blocking: true,
            message: `A legenda promete resultado garantido (${claims.map((c) => `"${c}"`).join(', ')}). Remova promessas de cura ou milagre.`,
          }
        : {
            code: 'forbidden_claims',
            label: 'Promessas proibidas',
            status: 'pass',
            blocking: false,
            message: 'Nenhuma promessa de cura, milagre ou resultado garantido.',
          },
      {
        code: 'brand_tone',
        label: 'Tom da marca',
        status: 'pass',
        blocking: false,
        message: 'Tom acolhedor e respeitoso, alinhado à marca.',
      },
    ];
  }
}
