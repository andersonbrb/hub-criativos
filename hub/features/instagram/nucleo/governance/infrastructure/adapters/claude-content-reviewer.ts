import type Anthropic from '@anthropic-ai/sdk';
import {
  AI_CHECK_CODES,
  type AiCheckCode,
  type ContentReviewer,
  type ContentReviewInput,
} from '../../application';
import type { ReviewCheckProps } from '../../domain';

export const CLAUDE_REVIEW_MODEL = 'claude-opus-5-5';

const LABELS: Record<AiCheckCode, string> = {
  translation_fidelity: 'Fidelidade da tradução',
  religious_accuracy: 'Coerência religiosa',
  forbidden_claims: 'Promessas proibidas',
  brand_tone: 'Tom da marca',
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', enum: [...AI_CHECK_CODES] },
          status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
          message: { type: 'string' },
        },
        required: ['code', 'status', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['checks'],
  additionalProperties: false,
} as const;

/** Fixo para aproveitar o cache de prompt. */
const SYSTEM_PROMPT = `Você revisa adaptações de legendas de Instagram de uma página católica devocional brasileira para outros mercados, antes da aprovação de um social media.

Avalie a legenda adaptada (com as hashtags) em quatro checagens e devolva uma entrada para cada:
- translation_fidelity: a adaptação preserva a mensagem, a oração e a intenção da original, no idioma do mercado, sem acrescentar nem cortar o essencial?
- religious_accuracy: santos, orações, datas e referências católicas estão corretos para o mercado?
- forbidden_claims: há promessa de cura, milagre ou resultado garantido, ou uso de algum termo proibido do mercado? Isso é "fail".
- brand_tone: o tom é acolhedor, respeitoso e natural para um nativo do mercado?

Status: "pass" (ok), "warn" (ajuste recomendado, não impede publicar) ou "fail" (problema sério). Use "fail" com parcimônia, só para o que não pode ir ao ar.
A mensagem de cada checagem é para o revisor humano: em português do Brasil, curta (até 2 frases) e específica — cite o trecho quando houver problema.`;

/**
 * Revisor de IA com o Claude. Pode falhar (rede, cota, recusa); a revisão automática
 * segue só com as checagens por regra, como já acontece hoje.
 */
export class ClaudeContentReviewer implements ContentReviewer {
  constructor(
    private readonly client: Anthropic,
    private readonly model: string = CLAUDE_REVIEW_MODEL,
  ) {}

  async review(input: ContentReviewInput): Promise<ReviewCheckProps[]> {
    const { market } = input;
    const request = [
      `Mercado: locale ${market.locale}`,
      `Produto: ${market.productName} · link da oferta: ${market.offerUrl}`,
      `Termos proibidos: ${market.forbiddenTerms.map((t) => `"${t}"`).join(', ') || 'nenhum'}`,
      `Glossário: ${market.glossary.map((t) => `"${t.source}" → "${t.target}"`).join('; ') || 'nenhum'}`,
      `Formato: ${input.format === 'reel' ? 'reel' : 'carrossel'}`,
      '',
      'Legenda original (pt-BR):',
      '<<<',
      input.sourceCaption,
      '>>>',
      '',
      'Legenda adaptada:',
      '<<<',
      input.caption,
      '>>>',
      `Hashtags: ${input.hashtags.join(' ') || 'nenhuma'}`,
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

    if (response.stop_reason === 'refusal') throw new Error('O Claude recusou revisar esta peça.');
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') throw new Error('O Claude não devolveu a revisão.');
    return parseReviewChecks(text.text);
  }
}

/** Uma checagem por código esperado; só "fail" de promessas proibidas bloqueia a aprovação. */
export function parseReviewChecks(raw: string): ReviewCheckProps[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Resposta do Claude não é JSON válido.');
  }
  const items = Array.isArray((data as { checks?: unknown })?.checks)
    ? ((data as { checks: unknown[] }).checks as {
        code?: unknown;
        status?: unknown;
        message?: unknown;
      }[])
    : [];
  const checks: ReviewCheckProps[] = [];
  for (const code of AI_CHECK_CODES) {
    const item = items.find((i) => i.code === code);
    if (!item) continue;
    const status = item.status === 'fail' || item.status === 'warn' ? item.status : 'pass';
    checks.push({
      code,
      label: LABELS[code],
      status,
      blocking: status === 'fail' && code === 'forbidden_claims',
      message:
        typeof item.message === 'string' && item.message.trim() !== ''
          ? item.message.trim()
          : LABELS[code],
    });
  }
  if (checks.length === 0) throw new Error('Resposta do Claude sem checagens.');
  return checks;
}
