/** `es-419` → `es`. Código ISO 639-1 do idioma (ElevenLabs, transcrição). */
export function isoLanguage(locale: string): string {
  return locale.split('-')[0]!.toLowerCase();
}

/**
 * Nome de idioma do HeyGen para o locale do mercado: `es-419` → "Spanish (Latin America)",
 * `fr-FR` → "French (France)". Sem a variante regional na lista, cai no idioma puro
 * ("Spanish"); `null` se nem isso existir.
 */
export function heygenLanguageFor(locale: string, available: readonly string[]): string | null {
  const [language, region] = locale.split('-');
  const languageName = new Intl.DisplayNames(['en'], { type: 'language' }).of(language!);
  if (!languageName) return null;
  const regionName = region
    ? new Intl.DisplayNames(['en'], { type: 'region' }).of(region.toUpperCase())
    : undefined;
  const candidates = [regionName ? `${languageName} (${regionName})` : null, languageName];
  for (const candidate of candidates) {
    if (candidate && available.includes(candidate)) return candidate;
  }
  return available.find((name) => name.startsWith(`${languageName} (`)) ?? null;
}
