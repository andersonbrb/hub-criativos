import { describe, expect, it } from 'vitest';
import { DomainError } from './domain-error';
import { Locale, languageOf } from './locale';

describe('Locale', () => {
  it('canonicaliza a tag BCP 47', () => {
    expect(Locale('es-419')).toBe('es-419');
    expect(Locale('fr-fr')).toBe('fr-FR');
  });

  it('rejeita tags inválidas', () => {
    expect(() => Locale('não-é-idioma')).toThrow(DomainError);
  });

  it('extrai o idioma base', () => {
    expect(languageOf(Locale('pt-BR'))).toBe('pt');
  });
});
