import { MarketErrors } from '../errors';

export interface GlossaryTerm {
  source: string;
  target: string;
}

/**
 * Termos que sempre traduzem do mesmo jeito neste mercado
 * (ex.: "São Bento" → "San Benito"). Sem termos de origem repetidos.
 */
export class Glossary {
  private constructor(readonly terms: readonly GlossaryTerm[]) {}

  static of(terms: GlossaryTerm[]): Glossary {
    const seen = new Set<string>();
    const cleaned = terms.map(({ source, target }) => {
      const s = source.trim();
      const t = target.trim();
      if (!s || !t) throw MarketErrors.emptyGlossaryTerm();
      const key = s.toLocaleLowerCase();
      if (seen.has(key)) throw MarketErrors.duplicateGlossaryTerm(s);
      seen.add(key);
      return { source: s, target: t };
    });
    return new Glossary(cleaned);
  }
}
