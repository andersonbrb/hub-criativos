import { AggregateRoot, DomainError } from '@sbs/shared-kernel';

export const EDITING_FONTS = [
  'Montserrat',
  'Poppins',
  'Inter',
  'Lora',
  'Playfair Display',
] as const;
export type EditingFont = (typeof EDITING_FONTS)[number];
export type CaptionsPosition = 'bottom' | 'middle';

/** Instruções de cada agente de edição (texto livre, editado pelo time no painel). */
export interface EditingGuidelines {
  /** Regras gerais: tom, público, limites (vale para o diretor e todos os especialistas). */
  principles: string;
  hook: string;
  body: string;
  cta: string;
  /** Headlines e legendas na tela. */
  headlines: string;
}

/** Aparência dos textos na tela. */
export interface EditingStyle {
  font: EditingFont;
  textColor: string;
  /** Cor das palavras destacadas nas legendas e do fundo do CTA. */
  highlightColor: string;
  captionsPosition: CaptionsPosition;
  showCaptions: boolean;
  showHeadline: boolean;
  showCtaCard: boolean;
}

export interface EditingStandardSnapshot {
  id: string;
  version: number;
  guidelines: EditingGuidelines;
  style: EditingStyle;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface EditingStandardChanges {
  guidelines?: Partial<EditingGuidelines>;
  style?: Partial<EditingStyle>;
}

export const DEFAULT_EDITING_GUIDELINES: Readonly<EditingGuidelines> = {
  principles:
    'Conteúdo devocional católico adaptado para outros países. Edição limpa e respeitosa, com foco na oração e na fé. Persuasão de resposta direta sem exagero: nunca prometer milagre, cura ou resultado garantido. Todo texto na tela no idioma do mercado (nada em português) e o nome do produto exatamente como no mercado. Textos curtos, legíveis no celular.',
  hook: 'Os 3 primeiros segundos decidem. Gancho na tela com até 8 palavras que abre um loop: curiosidade, identificação com a dor ("Se você sente…") ou uma promessa espiritual concreta. Mantenha o gancho original quando ele já prende; adapte quando a tradução ficar fraca ou literal.',
  body: 'Destaque nas legendas de 3 a 6 palavras com carga emocional (fé, proteção, família, o nome do santo). Não acrescente nada que o vídeo não fala.',
  cta: 'Uma única ação no final, clara e coerente com a oferta do mercado: comentar "Amém", salvar, compartilhar com alguém ou link na bio. Até 6 palavras, sem urgência falsa.',
  headlines:
    'Headline fixa no topo resume o tema em até 6 palavras. Legendas de 2 a 4 palavras por tela, grandes, com contorno, sem cobrir o rosto. Corrija erros de transcrição e preserve nomes próprios.',
};

export const DEFAULT_EDITING_STYLE: Readonly<EditingStyle> = {
  font: 'Montserrat',
  textColor: '#FFFFFF',
  highlightColor: '#F5C542',
  captionsPosition: 'bottom',
  showCaptions: true,
  showHeadline: true,
  showCtaCard: true,
};

const GUIDELINE_LABELS: Record<keyof EditingGuidelines, string> = {
  principles: 'Regras gerais',
  hook: 'Hook',
  body: 'Body',
  cta: 'CTA',
  headlines: 'Headlines e legendas',
};
const MAX_GUIDELINE = 4000;
const COLOR = /^#[0-9a-f]{6}$/i;

const invalid = (field: string, message: string) =>
  new DomainError('invalid_editing_standard', message, { field });

/**
 * Padrão de Edição: o manual que o diretor de edição e os especialistas de copy (Hook, Body,
 * CTA, Headlines/legendas) seguem, e o estilo dos textos na tela. Um só para a plataforma.
 */
export class EditingStandard extends AggregateRoot<string> {
  static readonly ID = 'default';

  private constructor(
    version: number,
    private _guidelines: EditingGuidelines,
    private _style: EditingStyle,
    private _updatedAt: Date | null,
    private _updatedBy: string | null,
  ) {
    super(EditingStandard.ID, version);
  }

  /** O padrão inicial, antes de o time editar. */
  static initial(): EditingStandard {
    return new EditingStandard(
      0,
      { ...DEFAULT_EDITING_GUIDELINES },
      { ...DEFAULT_EDITING_STYLE },
      null,
      null,
    );
  }

  static fromSnapshot(s: EditingStandardSnapshot): EditingStandard {
    return new EditingStandard(
      s.version,
      { ...DEFAULT_EDITING_GUIDELINES, ...s.guidelines },
      { ...DEFAULT_EDITING_STYLE, ...s.style },
      s.updatedAt ? new Date(s.updatedAt) : null,
      s.updatedBy,
    );
  }

  get guidelines(): Readonly<EditingGuidelines> {
    return this._guidelines;
  }

  get style(): Readonly<EditingStyle> {
    return this._style;
  }

  get updatedAt(): Date | null {
    return this._updatedAt;
  }

  get updatedBy(): string | null {
    return this._updatedBy;
  }

  update(changes: EditingStandardChanges, by: string, now: Date): void {
    const guidelines = { ...this._guidelines };
    for (const [key, value] of Object.entries(changes.guidelines ?? {}) as [
      keyof EditingGuidelines,
      string | undefined,
    ][]) {
      if (value === undefined) continue;
      const text = value.trim();
      if (!text) throw invalid(key, `${GUIDELINE_LABELS[key]}: escreva as instruções.`);
      if (text.length > MAX_GUIDELINE) {
        throw invalid(key, `${GUIDELINE_LABELS[key]}: até ${MAX_GUIDELINE} caracteres.`);
      }
      guidelines[key] = text;
    }

    const style = { ...this._style, ...definedOnly(changes.style ?? {}) };
    if (!EDITING_FONTS.includes(style.font)) throw invalid('font', 'Fonte não disponível.');
    if (!COLOR.test(style.textColor)) throw invalid('textColor', 'Cor do texto inválida.');
    if (!COLOR.test(style.highlightColor)) {
      throw invalid('highlightColor', 'Cor de destaque inválida.');
    }
    if (style.captionsPosition !== 'bottom' && style.captionsPosition !== 'middle') {
      throw invalid('captionsPosition', 'Posição das legendas inválida.');
    }

    this._guidelines = guidelines;
    this._style = {
      ...style,
      textColor: style.textColor.toUpperCase(),
      highlightColor: style.highlightColor.toUpperCase(),
    };
    this._updatedAt = now;
    this._updatedBy = by;
  }

  toSnapshot(): EditingStandardSnapshot {
    return {
      id: this.id,
      version: this.version,
      guidelines: { ...this._guidelines },
      style: { ...this._style },
      updatedAt: this._updatedAt?.toISOString() ?? null,
      updatedBy: this._updatedBy,
    };
  }
}

function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
