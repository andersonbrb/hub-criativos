import { DomainError } from './domain-error';

export const CONTENT_FORMATS = ['reel', 'carousel', 'image', 'story'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

/** Formatos que a plataforma já sabe adaptar (stories entram numa fase futura). */
export const ADAPTABLE_FORMATS = ['reel', 'carousel'] as const satisfies readonly ContentFormat[];
export type AdaptableFormat = (typeof ADAPTABLE_FORMATS)[number];

export function ContentFormat(value: string): ContentFormat {
  if (!(CONTENT_FORMATS as readonly string[]).includes(value)) {
    throw new DomainError('invalid_content_format', `Formato desconhecido: "${value}".`, { value });
  }
  return value as ContentFormat;
}

export function isAdaptable(format: ContentFormat): format is AdaptableFormat {
  return (ADAPTABLE_FORMATS as readonly string[]).includes(format);
}
