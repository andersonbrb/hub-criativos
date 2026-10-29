import type { Brand } from './brand';
import { DomainError } from './domain-error';

/** Tag BCP 47 canônica, ex.: `pt-BR`, `es-419`, `fr-FR`. */
export type Locale = Brand<string, 'Locale'>;

export function Locale(tag: string): Locale {
  let canonical: string | undefined;
  try {
    [canonical] = Intl.getCanonicalLocales(tag);
  } catch {
    canonical = undefined;
  }
  if (!canonical) throw new DomainError('invalid_locale', `Idioma inválido: "${tag}".`, { tag });
  return canonical as Locale;
}

/** Idioma base sem a região: `es-419` → `es`. */
export function languageOf(locale: Locale): string {
  return locale.split('-')[0]!;
}
