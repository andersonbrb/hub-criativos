import { Locale, languageOf } from '@sbs/shared-kernel';
import type { CopyLocalizer, LocalizeCopyInput, LocalizedCopy } from '../../application';

const HASHTAGS_BY_LANGUAGE: Record<string, string[]> = {
  es: ['#oracion', '#fe', '#bendiciones'],
  fr: ['#priere', '#foi', '#benediction'],
  en: ['#prayer', '#faith', '#blessings'],
  it: ['#preghiera', '#fede', '#benedizione'],
  pt: ['#oracao', '#fe', '#bencaos'],
};
const DEFAULT_HASHTAGS = ['#faith', '#prayer'];

/**
 * Localizador determinístico para dev e testes: não traduz de verdade, mas aplica o
 * glossário do mercado, troca as hashtags e acrescenta o CTA da oferta. Quando há
 * sugestão do revisor, deixa uma linha marcando que ela foi aplicada, para a demo
 * mostrar a revisão mudando.
 */
export class FakeCopyLocalizer implements CopyLocalizer {
  readonly requests: LocalizeCopyInput[] = [];

  async localize(input: LocalizeCopyInput): Promise<LocalizedCopy> {
    this.requests.push(input);
    const { market } = input;

    let body = stripHashtags(input.sourceCaption);
    for (const term of market.glossary) {
      body = body.replace(new RegExp(escapeRegExp(term.source), 'giu'), term.target);
    }

    const lines = [body, `👉 ${market.productName}: ${market.offerUrl}`];
    if (input.suggestion) lines.push(`✍️ Ajuste aplicado: ${input.suggestion}`);

    return {
      caption: lines.filter((l) => l.length > 0).join('\n\n'),
      hashtags: buildHashtags(market.productName, market.locale, input.format),
    };
  }
}

function buildHashtags(productName: string, locale: string, format: 'reel' | 'carousel'): string[] {
  const language = languageOf(Locale(locale));
  const product = `#${slug(productName)}`;
  const tags = [product, ...(HASHTAGS_BY_LANGUAGE[language] ?? DEFAULT_HASHTAGS)];
  if (format === 'reel') tags.push('#reels');
  return [...new Set(tags)];
}

function stripHashtags(caption: string): string {
  return caption
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '$1')
    .replace(/[ \t]+$/gmu, '')
    .trim();
}

/** `Saint Benoît` → `saintbenoit`. */
function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
