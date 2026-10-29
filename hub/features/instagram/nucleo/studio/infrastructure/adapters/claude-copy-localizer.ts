import type Anthropic from '@anthropic-ai/sdk';
import type { CopyLocalizer, LocalizeCopyInput, LocalizedCopy } from '../../application';

export const CLAUDE_COPY_MODEL = 'claude-opus-5-5';

/** Saída pedida ao Claude (structured outputs): legenda sem hashtags + lista de hashtags. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
  required: ['caption', 'hashtags'],
  additionalProperties: false,
} as const;

/** Fixo para aproveitar o cache de prompt: nada variável aqui. */
const SYSTEM_PROMPT = `Você adapta legendas de Instagram de uma página católica devocional brasileira para outros mercados.

Seu trabalho é uma adaptação cultural, não uma tradução literal: escreva como um social media nativo do mercado escreveria, para o mesmo público (católicos devotos, em geral mais velhos), preservando a mensagem, a oração e o tom de fé da original.

Regras:
- Escreva inteiramente no idioma do mercado (locale informado).
- Aplique o glossário do mercado: cada termo de origem vira exatamente o termo de destino (por exemplo, nomes de santos e do produto).
- Nunca use nenhum dos termos proibidos do mercado, em nenhuma forma.
- Não prometa cura, milagre ou resultado garantido; fé e esperança, sim; garantias, não.
- Mantenha os emojis com moderação, onde fizerem sentido.
- Termine a legenda com uma chamada curta para a oferta, citando o nome do produto e o link exatamente como informados.
- Não coloque hashtags dentro da legenda: devolva-as separadas, de 3 a 8, cada uma começando com # e sem espaços, no idioma do mercado, incluindo uma com o nome do produto.
- Legenda + hashtags devem caber em 2.000 caracteres.
- Se houver uma sugestão do revisor, aplique-a.`;

/**
 * Adapta a legenda com o Claude. Erros de rede, cota ou recusa sobem como exceção: a
 * produção da peça marca falha e o revisor pode tentar de novo.
 */
export class ClaudeCopyLocalizer implements CopyLocalizer {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string = CLAUDE_COPY_MODEL,
  ) {}

  async localize(input: LocalizeCopyInput): Promise<LocalizedCopy> {
    const { market } = input;
    const request = [
      `Mercado: ${market.name} (locale ${market.locale})`,
      `Formato do post: ${input.format === 'reel' ? 'reel (vídeo)' : 'carrossel'}`,
      `Produto: ${market.productName}`,
      `Link da oferta: ${market.offerUrl}`,
      `Glossário (origem → destino): ${
        market.glossary.length > 0
          ? market.glossary.map((t) => `"${t.source}" → "${t.target}"`).join('; ')
          : 'nenhum'
      }`,
      `Termos proibidos: ${
        market.forbiddenTerms.length > 0
          ? market.forbiddenTerms.map((t) => `"${t}"`).join(', ')
          : 'nenhum'
      }`,
      `Sugestão do revisor: ${input.suggestion ?? 'nenhuma'}`,
      '',
      `Legenda original (${input.sourceLocale}):`,
      '<<<',
      input.sourceCaption,
      '>>>',
    ].join('\n');

    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: request }],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error('O Claude recusou adaptar esta legenda.');
    }
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') throw new Error('O Claude não devolveu a legenda.');
    return parseLocalizedCopy(text.text);
  }
}

/** Valida e normaliza a resposta (hashtags com #, sem repetidas, sem espaços). */
export function parseLocalizedCopy(raw: string): LocalizedCopy {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Resposta do Claude não é JSON válido.');
  }
  const { caption, hashtags } = (data ?? {}) as { caption?: unknown; hashtags?: unknown };
  if (typeof caption !== 'string' || caption.trim() === '') {
    throw new Error('Resposta do Claude sem legenda.');
  }
  const tags = Array.isArray(hashtags) ? hashtags : [];
  const normalized = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map((tag) => `#${tag.trim().replace(/^#+/, '').replace(/\s+/g, '')}`)
    .filter((tag) => /^#[\p{L}\p{N}_]+$/u.test(tag));
  return { caption: caption.trim(), hashtags: [...new Set(normalized)] };
}
