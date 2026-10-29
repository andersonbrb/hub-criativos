import type Anthropic from '@anthropic-ai/sdk';
import type { EditingGuidelines } from '@sbs/studio';
import { JUDGE_MODEL } from './claude-judges';

export type CopyRole = 'hook' | 'body' | 'cta' | 'headlines';
export const COPY_ROLES: readonly CopyRole[] = ['hook', 'body', 'cta', 'headlines'];

/** O que os agentes de edição sabem sobre o reel. */
export interface EditingBrief {
  locale: string;
  productName: string;
  /** Legenda original do post (pt-BR), para entender a intenção. */
  sourceCaption: string;
  /** O que é falado no vídeo traduzido (vazio se não houver transcrição). */
  transcript: string;
  durationInSeconds: number;
  guidelines: EditingGuidelines;
  /** Parecer do revisor de edição na tentativa anterior. */
  feedback: string | null;
  /** Motivo do social media ao reprovar e voltar para a edição (prioridade máxima). */
  request: string | null;
}

/** Proposta de um especialista de copy: manter o que existe ou adaptar para melhorar. */
export interface CopyProposal {
  role: CopyRole;
  decision: 'keep' | 'adapt';
  /** Hook: gancho na tela · CTA: cartão final · Headlines: título fixo · Body: vazio. */
  text: string;
  /** Body: palavras para destacar nas legendas. */
  emphasis: string[];
  rationale: string;
}

/** A edição final decidida pelo diretor (vazio = sem esse elemento). */
export interface DirectorCut {
  hook: string;
  headline: string;
  cta: string;
  emphasis: string[];
  notes: string;
}

export interface EditingAgents {
  propose(role: CopyRole, brief: EditingBrief): Promise<CopyProposal>;
  direct(brief: EditingBrief, proposals: CopyProposal[]): Promise<DirectorCut>;
  /** Revisor de edição: olha quadros do vídeo editado (gancho, meio, CTA). */
  review(
    brief: EditingBrief,
    cut: DirectorCut,
    frames: { data: string; mediaType: 'image/jpeg' }[],
  ): Promise<{ approved: boolean; notes: string }>;
}

const TEAM =
  'Você faz parte da equipe de edição de criativos de resposta direta (infoprodutos, copy persuasiva) de uma página católica devocional brasileira que adapta reels para outros países. O áudio do vídeo já foi traduzido; a equipe cuida dos textos na tela.';

const ROLE_BRIEF: Record<CopyRole, { title: string; task: string }> = {
  hook: {
    title: 'especialista em Hook (gancho dos 3 primeiros segundos)',
    task: 'Proponha o texto do gancho que aparece na tela no início. "keep" se o gancho falado/original já prende e só precisa ir para a tela fiel; "adapt" se precisa ficar mais forte. `text` = o gancho; `emphasis` = [].',
  },
  body: {
    title: 'especialista em Body (desenvolvimento)',
    task: 'Escolha as palavras faladas que devem ser destacadas nas legendas para reforçar a mensagem. "keep" se o corpo já funciona sem destaque extra (emphasis curto), "adapt" se destacar muda a força da mensagem. `text` = ""; `emphasis` = palavras exatamente como são faladas na transcrição.',
  },
  cta: {
    title: 'especialista em CTA (chamada para ação)',
    task: 'Proponha o texto do cartão de chamada para ação do final. "keep" se o vídeo já termina com um CTA claro (leve-o para a tela fiel), "adapt" se precisa de um CTA melhor. `text` = o CTA; `emphasis` = [].',
  },
  headlines: {
    title: 'especialista em Headlines e legendas',
    task: 'Proponha a headline fixa no topo do vídeo, que resume o tema. "keep" se a headline óbvia do conteúdo já é boa, "adapt" se dá para deixá-la mais persuasiva. `text` = a headline; `emphasis` = [].',
  },
};

const GUIDELINE_FOR: Record<CopyRole, keyof EditingGuidelines> = {
  hook: 'hook',
  body: 'body',
  cta: 'cta',
  headlines: 'headlines',
};

function briefText(brief: EditingBrief): string {
  return [
    `Mercado: locale ${brief.locale} · produto: ${brief.productName}`,
    `Duração do vídeo: ${brief.durationInSeconds.toFixed(1)} s`,
    '',
    'Legenda original do post (pt-BR):',
    '<<<',
    brief.sourceCaption || '(sem legenda)',
    '>>>',
    '',
    'Transcrição do vídeo traduzido:',
    '<<<',
    brief.transcript || '(sem transcrição disponível)',
    '>>>',
    ...(brief.request
      ? [
          '',
          `O social media reprovou a versão anterior e devolveu para a edição. Atenda a este pedido antes de tudo: ${brief.request}`,
        ]
      : []),
    ...(brief.feedback
      ? ['', `O revisor de edição reprovou a tentativa anterior: ${brief.feedback}`]
      : []),
  ].join('\n');
}

const LANGUAGE_RULE =
  'Todo texto que vai para a tela fica no idioma do locale do mercado (nunca em português). `rationale`/`notes` em português do Brasil, curtos (até 2 frases).';

const BETAS = ['server-side-fallback-2026-07-01'];

/** Os agentes de edição com o Claude (saída estruturada). */
export class ClaudeEditingAgents implements EditingAgents {
  constructor(private readonly client: Anthropic) {}

  async propose(role: CopyRole, brief: EditingBrief): Promise<CopyProposal> {
    const { title, task } = ROLE_BRIEF[role];
    const parsed = await this.json<Omit<CopyProposal, 'role'>>(
      [
        TEAM,
        `Você é o ${title}.`,
        task,
        LANGUAGE_RULE,
        `Padrão de Edição — regras gerais:\n${brief.guidelines.principles}`,
        `Padrão de Edição — sua área:\n${brief.guidelines[GUIDELINE_FOR[role]]}`,
      ].join('\n\n'),
      [{ type: 'text', text: briefText(brief) }],
      {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['keep', 'adapt'] },
          text: { type: 'string' },
          emphasis: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
        required: ['decision', 'text', 'emphasis', 'rationale'],
        additionalProperties: false,
      },
      'low',
    );
    return {
      role,
      decision: parsed.decision === 'adapt' ? 'adapt' : 'keep',
      text: String(parsed.text ?? '').trim(),
      emphasis: Array.isArray(parsed.emphasis) ? parsed.emphasis.map(String).slice(0, 8) : [],
      rationale: String(parsed.rationale ?? '').trim(),
    };
  }

  async direct(brief: EditingBrief, proposals: CopyProposal[]): Promise<DirectorCut> {
    const parsed = await this.json<DirectorCut>(
      [
        TEAM,
        'Você é o diretor de edição: especialista em criativos persuasivos para infoprodutos (Hook, Body e CTA). Recebe as propostas dos quatro especialistas e decide a edição final: aceita, ajusta ou descarta cada uma, garantindo coerência entre gancho, headline e CTA, o nome do produto correto, nada de promessa de milagre ou cura, e textos curtos legíveis no celular. Deixe vazio ("") o elemento que não deve aparecer.',
        LANGUAGE_RULE,
        `Padrão de Edição — regras gerais:\n${brief.guidelines.principles}`,
      ].join('\n\n'),
      [
        {
          type: 'text',
          text: `${briefText(brief)}\n\nPropostas dos especialistas:\n${JSON.stringify(proposals, null, 2)}`,
        },
      ],
      {
        type: 'object',
        properties: {
          hook: { type: 'string' },
          headline: { type: 'string' },
          cta: { type: 'string' },
          emphasis: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        required: ['hook', 'headline', 'cta', 'emphasis', 'notes'],
        additionalProperties: false,
      },
      'medium',
    );
    return {
      hook: String(parsed.hook ?? '').trim(),
      headline: String(parsed.headline ?? '').trim(),
      cta: String(parsed.cta ?? '').trim(),
      emphasis: Array.isArray(parsed.emphasis) ? parsed.emphasis.map(String).slice(0, 8) : [],
      notes: String(parsed.notes ?? '').trim(),
    };
  }

  async review(
    brief: EditingBrief,
    cut: DirectorCut,
    frames: { data: string; mediaType: 'image/jpeg' }[],
  ) {
    const parsed = await this.json<{ approved: boolean; notes: string }>(
      [
        TEAM,
        'Você é o revisor de edição. Olhe os quadros do vídeo editado (início com o gancho, meio, final com o CTA) e aprove só se: os textos estão legíveis e não cobrem o rosto, estão no idioma do mercado sem erros de ortografia, o nome do produto está certo, não há promessa de milagre/cura e a edição segue o Padrão de Edição. Se reprovar, diga exatamente o que corrigir.',
        LANGUAGE_RULE,
        `Padrão de Edição:\n${Object.values(brief.guidelines).join('\n\n')}`,
      ].join('\n\n'),
      [
        ...frames.map((frame) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: frame.mediaType, data: frame.data },
        })),
        {
          type: 'text',
          text: `${briefText(brief)}\n\nEdição aplicada:\n${JSON.stringify(cut, null, 2)}`,
        },
      ],
      {
        type: 'object',
        properties: { approved: { type: 'boolean' }, notes: { type: 'string' } },
        required: ['approved', 'notes'],
        additionalProperties: false,
      },
      'medium',
    );
    return {
      approved: parsed.approved === true,
      notes: String(parsed.notes ?? '').trim() || '—',
    };
  }

  private async json<T>(
    system: string,
    content: Anthropic.Beta.Messages.BetaContentBlockParam[],
    schema: Record<string, unknown>,
    effort: 'low' | 'medium',
  ): Promise<Partial<T>> {
    const response = await this.client.beta.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 4096,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') throw new Error('a IA recusou esta edição.');
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') throw new Error('a IA não respondeu.');
    return JSON.parse(text.text) as Partial<T>;
  }
}
