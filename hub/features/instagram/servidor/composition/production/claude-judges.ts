import type Anthropic from '@anthropic-ai/sdk';

export const JUDGE_MODEL = 'claude-opus-5-5';

export interface TranscriptComparison {
  locale: string;
  productName: string;
  originalTranscript: string;
  translatedTranscript: string;
  /** O que a ferramenta fez: "tradução de vídeo (HeyGen)", "dublagem (ElevenLabs)". */
  what: string;
}

export interface ImagePair {
  /** "Slide 1", "Capa"… */
  label: string;
  original: { data: string; mediaType: string };
  edited: { data: string; mediaType: string };
}

export interface ImageComparison {
  locale: string;
  productName: string;
  pairs: ImagePair[];
}

/** A peça inteira para o revisor geral: mídia final (imagens), legenda e o que a produção relatou. */
export interface WholePiece {
  format: 'reel' | 'carousel';
  locale: string;
  productName: string;
  caption: string;
  hashtags: string[];
  sourceCaption: string;
  production: {
    step: string;
    status: string;
    summary: string | null;
    reviewNotes: string | null;
    note: string | null;
  }[];
  images: { label: string; data: string; mediaType: string }[];
}

/** Decisões que pedem julgamento (visão e comparação de textos). */
export interface ProductionJudge {
  /** A capa mostra uma pessoa falando para a câmera? (decide HeyGen × ElevenLabs) */
  speaksToCamera(image: { data: string; mediaType: string }): Promise<boolean>;
  /** A tradução falada é fiel e está no idioma certo? */
  compareTranscripts(input: TranscriptComparison): Promise<{ approved: boolean; notes: string }>;
  /** As imagens adaptadas estão traduzidas e fiéis ao original? `failed`: índices a refazer. */
  compareImages(
    input: ImageComparison,
  ): Promise<{ approved: boolean; notes: string; failed: number[] }>;
  /** Revisor geral: a peça está pronta para o social media aprovar? */
  reviewWhole(piece: WholePiece): Promise<{ status: 'pass' | 'warn' | 'fail'; message: string }>;
  /** Os quadros mostram legendas ou textos queimados no vídeo? */
  hasBurnedText(frames: VideoFrame[]): Promise<boolean>;
  /** Os quadros "depois" ficaram sem legendas e sem marcas da remoção? */
  compareSubtitleRemoval(
    pairs: { label: string; before: VideoFrame; after: VideoFrame }[],
  ): Promise<{ approved: boolean; notes: string }>;
}

export interface VideoFrame {
  data: string;
  mediaType: string;
}

const BETAS = ['server-side-fallback-2026-07-01'];

/** Juiz com o Claude (saída estruturada; fallback do servidor em recusa). */
export class ClaudeJudge implements ProductionJudge {
  constructor(private readonly client: Anthropic) {}

  async speaksToCamera(image: { data: string; mediaType: string }): Promise<boolean> {
    const response = await this.client.beta.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 1024,
      betas: BETAS,
      fallbacks: 'default',
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { speaks_to_camera: { type: 'boolean' } },
            required: ['speaks_to_camera'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
                data: image.data,
              },
            },
            {
              type: 'text',
              text: 'Esta é a capa de um reel. Há uma pessoa em destaque, de rosto visível, que parece estar falando diretamente para a câmera? Responda false para narração sobre imagens, texto na tela, paisagens ou objetos.',
            },
          ],
        },
      ],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return true;
    try {
      return Boolean((JSON.parse(text.text) as { speaks_to_camera?: unknown }).speaks_to_camera);
    } catch {
      return true;
    }
  }

  async compareTranscripts(input: TranscriptComparison) {
    const response = await this.client.beta.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 4096,
      betas: BETAS,
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { approved: { type: 'boolean' }, notes: { type: 'string' } },
            required: ['approved', 'notes'],
            additionalProperties: false,
          },
        },
      },
      system:
        'Você revisa vídeos de uma página católica devocional brasileira adaptados para outros mercados. Compare a transcrição do vídeo original com a do vídeo traduzido. Aprove se a tradução está no idioma do mercado, preserva a mensagem e a oração sem cortes ou acréscimos relevantes e cita o produto corretamente. Reprove se estiver em outro idioma, faltar trecho importante, mudar o sentido ou trouxer promessa de cura/milagre garantido. As notas vão para a equipe: em português do Brasil, curtas (até 2 frases) e específicas, citando o trecho com problema.',
      messages: [
        {
          role: 'user',
          content: [
            `Etapa: ${input.what}`,
            `Mercado: locale ${input.locale} · produto: ${input.productName}`,
            '',
            'Transcrição do original (pt-BR):',
            '<<<',
            input.originalTranscript || '(sem fala detectada)',
            '>>>',
            '',
            'Transcrição do traduzido:',
            '<<<',
            input.translatedTranscript || '(sem fala detectada)',
            '>>>',
          ].join('\n'),
        },
      ],
    });
    if (response.stop_reason === 'refusal') {
      return { approved: false, notes: 'O revisor de IA recusou avaliar este vídeo.' };
    }
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text')
      return { approved: false, notes: 'O revisor não respondeu.' };
    const parsed = JSON.parse(text.text) as { approved?: unknown; notes?: unknown };
    return {
      approved: parsed.approved === true,
      notes: typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : '—',
    };
  }

  async hasBurnedText(frames: VideoFrame[]): Promise<boolean> {
    const parsed = await this.ask<{ has_text?: unknown }>(
      'Você olha quadros de um reel. Responda se há legendas ou textos escritos queimados no vídeo (falas transcritas, frases na tela, títulos). Ignore logotipos pequenos de canto e texto que faz parte da cena real (placas, rótulos de produtos).',
      frames.flatMap((frame, index) => [
        { type: 'text' as const, text: `Quadro ${index + 1}:` },
        imageBlock(frame),
      ]),
      {
        type: 'object',
        properties: { has_text: { type: 'boolean' } },
        required: ['has_text'],
        additionalProperties: false,
      },
      'low',
    );
    // Na dúvida, remove: legenda em português que sobra é pior que uma remoção a mais.
    return parsed.has_text !== false;
  }

  async compareSubtitleRemoval(pairs: { label: string; before: VideoFrame; after: VideoFrame }[]) {
    const parsed = await this.ask<{ approved?: unknown; notes?: unknown }>(
      'Você revisa a remoção de legendas de um reel. Para cada momento há o quadro antes e depois. Aprove só se as legendas e textos escritos sumiram e o lugar onde estavam ficou natural (sem borrão forte, mancha ou pedaço de letra) e o resto da imagem continua igual. Notas para a equipe: em português do Brasil, curtas e específicas, citando o momento.',
      pairs.flatMap((pair) => [
        { type: 'text' as const, text: `${pair.label} — antes:` },
        imageBlock(pair.before),
        { type: 'text' as const, text: `${pair.label} — depois:` },
        imageBlock(pair.after),
      ]),
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
      notes: typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : '—',
    };
  }

  /** Pergunta com saída estruturada; devolve o JSON da resposta. */
  private async ask<T>(
    system: string,
    content: Anthropic.Beta.Messages.BetaContentBlockParam[],
    schema: Record<string, unknown>,
    effort: 'low' | 'medium',
  ): Promise<Partial<T>> {
    const response = await this.client.beta.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 2048,
      betas: BETAS,
      fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') throw new Error('a IA recusou avaliar');
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('a IA não respondeu');
    return JSON.parse(text.text) as Partial<T>;
  }

  async reviewWhole(piece: WholePiece) {
    type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
    const content: Block[] = piece.images.flatMap((image): Block[] => [
      { type: 'text', text: `${image.label}:` },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: image.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
          data: image.data,
        },
      },
    ]);
    const production = piece.production
      .map(
        (s) =>
          `- ${s.step} (${s.status})${s.summary ? `: ${s.summary.replace(/\n/g, ' · ')}` : ''}${
            s.reviewNotes ? ` | revisor: ${s.reviewNotes}` : ''
          }${s.note ? ` | ${s.note}` : ''}`,
      )
      .join('\n');
    content.push({
      type: 'text',
      text: [
        `Formato: ${piece.format === 'reel' ? 'reel' : 'carrossel'} · mercado: locale ${piece.locale} · produto: ${piece.productName}`,
        '',
        'Legenda original (pt-BR):',
        '<<<',
        piece.sourceCaption,
        '>>>',
        '',
        'Legenda adaptada:',
        '<<<',
        piece.caption,
        '>>>',
        `Hashtags: ${piece.hashtags.join(' ') || 'nenhuma'}`,
        '',
        'O que a linha de produção relatou:',
        production || '(sem etapas registradas)',
      ].join('\n'),
    });
    const response = await this.client.beta.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 4096,
      betas: BETAS,
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['pass', 'warn', 'fail'] },
              message: { type: 'string' },
            },
            required: ['status', 'message'],
            additionalProperties: false,
          },
        },
      },
      system:
        'Você é o revisor geral de uma página católica devocional brasileira que adapta posts para outros países: o último olhar antes do social media decidir. Avalie a peça inteira como o seguidor vai ver — imagens (capa, quadros do vídeo ou slides) e legenda juntas — e o que cada etapa da produção relatou. Confira: tudo no idioma do mercado (nada em português na tela), nome do produto correto, coerência entre gancho, vídeo/slides, legenda e CTA, qualidade visual (texto legível, nada cortado ou deformado), nenhuma promessa de milagre ou cura. "pass": pronta para aprovar; "warn": dá para aprovar com ressalvas; "fail": recomende reprovar ou voltar para a edição. A mensagem vai para o social media: em português do Brasil, até 3 frases, específica, terminando com a recomendação (aprovar, voltar para a edição dizendo o quê, ou reprovar).',
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') throw new Error('a IA recusou revisar esta peça');
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('a IA não respondeu');
    const parsed = JSON.parse(text.text) as { status?: unknown; message?: unknown };
    const status = parsed.status === 'fail' || parsed.status === 'warn' ? parsed.status : 'pass';
    const message =
      typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message.trim()
        : 'Peça revisada.';
    return { status, message } as const;
  }

  async compareImages(input: ImageComparison) {
    type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
    const image = (img: { data: string; mediaType: string }): Block => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
        data: img.data,
      },
    });
    const content: Block[] = input.pairs.flatMap((pair, index): Block[] => [
      { type: 'text', text: `${index}. ${pair.label} — original:` },
      image(pair.original),
      { type: 'text', text: `${index}. ${pair.label} — adaptada:` },
      image(pair.edited),
    ]);
    content.push({
      type: 'text',
      text: `Mercado: locale ${input.locale} · produto: ${input.productName}. Avalie cada par (índices 0 a ${input.pairs.length - 1}).`,
    });
    const response = await this.client.beta.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 4096,
      betas: BETAS,
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
              notes: { type: 'string' },
              failed: { type: 'array', items: { type: 'integer' } },
            },
            required: ['approved', 'notes', 'failed'],
            additionalProperties: false,
          },
        },
      },
      system:
        'Você revisa imagens de uma página católica devocional brasileira adaptadas para outros mercados (slides de carrossel e capas de reel). Para cada par original/adaptada, aprove só se: todo texto visível foi para o idioma do mercado (nada em português), sem erros de ortografia nem letras deformadas, o nome do produto está correto, o layout, as cores, as pessoas e os objetos continuam iguais e nada estranho foi acrescentado. Em "failed", liste os índices dos pares que precisam ser refeitos (vazio se todos estão bons). As notas vão para a equipe: em português do Brasil, curtas e específicas, citando o slide.',
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') {
      return { approved: false, notes: 'O revisor de IA recusou avaliar as imagens.', failed: [] };
    }
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return { approved: false, notes: 'O revisor não respondeu.', failed: [] };
    }
    const parsed = JSON.parse(text.text) as {
      approved?: unknown;
      notes?: unknown;
      failed?: unknown;
    };
    const failed = Array.isArray(parsed.failed)
      ? parsed.failed.filter(
          (n): n is number =>
            Number.isInteger(n) && Number(n) >= 0 && Number(n) < input.pairs.length,
        )
      : [];
    return {
      approved: parsed.approved === true && failed.length === 0,
      notes: typeof parsed.notes === 'string' && parsed.notes.trim() ? parsed.notes.trim() : '—',
      failed,
    };
  }
}

function imageBlock(image: VideoFrame): Anthropic.Beta.Messages.BetaContentBlockParam {
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
      data: image.data,
    },
  };
}
