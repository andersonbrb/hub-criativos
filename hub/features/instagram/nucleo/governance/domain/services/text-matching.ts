/**
 * Comparação de texto tolerante a maiúsculas e acentos ("Saint Benoît" = "saint benoit"),
 * porque legendas traduzidas por IA e termos cadastrados à mão raramente batem byte a byte.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Só letras e números: "#Sagrado_Verso" e "Sagrado Verso" viram "sagradoverso". */
export function compactText(text: string): string {
  return normalizeText(text).replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * `term` aparece em `text` como palavra/expressão inteira. Exigir fronteira evita falsos
 * positivos que bloqueariam a peça à toa, como "cura" dentro de "procura".
 */
export function containsTerm(text: string, term: string): boolean {
  const needle = normalizeText(term);
  if (!needle) return false;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'u');
  return pattern.test(normalizeText(text));
}

/**
 * `term` aparece dentro de uma hashtag. Hashtags juntam palavras ("#sagradoverso"),
 * então a comparação é por substring, sem `#`, espaços nem pontuação.
 */
export function hashtagContainsTerm(hashtag: string, term: string): boolean {
  const needle = compactText(term);
  return needle.length > 0 && compactText(hashtag).includes(needle);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
