import type {
  EditingGuidelines,
  EditingStyle,
  ProductionContext,
  ProductionReviewer,
  ProductionSpecialist,
  ProductionStage,
  SpecialistResult,
} from '@sbs/studio';
import type {
  HubElevenLabs,
  HubFlora,
  HubHeygen,
  HubTranscriber,
  VideoRenderer,
} from '../../infrastructure/integrations/hub-tools';
import type { VmakeClient } from '../../infrastructure/integrations/vmake-client';
import type { MediaStorage } from '../media-storage';
import type { ProductionJudge } from './claude-judges';
import type { EditingAgents } from './editing-agents';
import { heygenLanguageFor, isoLanguage } from './languages';
import { checkMediaLink, downloadImage, outputKey, storeOutput } from './media-helpers';

type Fetch = typeof fetch;

/** Ferramentas disponíveis agora (conforme a central de integrações). */
export interface ProductionTools {
  /** HeyGen e ElevenLabs pelos logins das contas no hub (Integrações). */
  heygen(): Promise<HubHeygen | null>;
  elevenlabs(): Promise<HubElevenLabs | null>;
  /** Transcrição do hub (Whisper, com o Scribe do ElevenLabs de reserva): não depende de login. */
  transcriber(): Promise<HubTranscriber | null>;
  judge(): Promise<ProductionJudge | null>;
  /** Remoção de legendas dos reels. */
  vmake(): Promise<VmakeClient | null>;
  /** Edição de imagens (slides e capas). */
  flora(): Promise<HubFlora | null>;
  /** Diretor de edição e especialistas de copy (Claude). */
  editing(): Promise<EditingAgents | null>;
  /** Padrão de Edição atual (editado no painel). */
  editingStandard(): Promise<{ guidelines: EditingGuidelines; style: EditingStyle }>;
  /** Editor de vídeo (Remotion); `null` onde não há como renderizar. */
  renderer: VideoRenderer | null;
  /** `isOwnLink`: o resultado já é mídia do hub (não precisa guardar de novo). */
  media: Pick<MediaStorage, 'resolve'> & Partial<Pick<MediaStorage, 'isOwnLink'>>;
  fetch: Fetch;
}

type Tool = 'heygen' | 'elevenlabs';
interface Decision {
  tool: Tool | null;
  reason: string;
}


/**
 * Decide quem traduz o reel, uma vez por produção: a escolha feita na seleção ou, no modo
 * automático, o Claude olhando a capa (pessoa falando para a câmera → HeyGen, pela sincronia
 * labial; narração sem rosto → ElevenLabs).
 */
export class TranslationRouter {
  private readonly decisions = new Map<string, Promise<Decision>>();

  constructor(private readonly tools: ProductionTools) {}

  decide(context: ProductionContext): Promise<Decision> {
    const key = `${context.contentPieceId}:${context.revisionNumber}`;
    let decision = this.decisions.get(key);
    if (!decision) {
      decision = this.compute(context);
      this.decisions.set(key, decision);
    }
    return decision;
  }

  private async compute(context: ProductionContext): Promise<Decision> {
    const [heygen, elevenlabs] = await Promise.all([this.tools.heygen(), this.tools.elevenlabs()]);
    const connected = { heygen: heygen !== null, elevenlabs: elevenlabs !== null };
    const choice = context.options.videoTranslation;
    if (choice !== 'auto') {
      return connected[choice]
        ? { tool: choice, reason: 'escolhido na seleção do post' }
        : { tool: null, reason: `${choice === 'heygen' ? 'HeyGen' : 'ElevenLabs'} não conectado` };
    }

    let preferred: Tool = 'heygen';
    let reason = 'padrão (IA não conectada para analisar a capa)';
    const judge = await this.tools.judge();
    if (judge && context.media.coverUrl) {
      try {
        const image = await downloadImage(this.tools.fetch, context.media.coverUrl);
        const speaks = await judge.speaksToCamera(image);
        preferred = speaks ? 'heygen' : 'elevenlabs';
        reason = speaks
          ? 'automático: a capa mostra alguém falando para a câmera'
          : 'automático: narração sem rosto na capa';
      } catch {
        reason = 'padrão (não foi possível analisar a capa)';
      }
    }
    if (connected[preferred]) return { tool: preferred, reason };
    const other: Tool = preferred === 'heygen' ? 'elevenlabs' : 'heygen';
    if (connected[other]) return { tool: other, reason: `${reason}; ${preferred} não conectado` };
    return { tool: null, reason: 'nem HeyGen nem ElevenLabs conectados' };
  }
}

const doneBy = (tool: Tool) => (tool === 'heygen' ? 'pelo HeyGen' : 'pela ElevenLabs');

async function skipFor(
  router: TranslationRouter,
  context: ProductionContext,
  tool: Tool,
): Promise<string | null> {
  if (context.format !== 'reel') return 'Carrossel: não há vídeo para traduzir.';
  const decision = await router.decide(context);
  if (decision.tool === tool) return null;
  if (decision.tool === null) return `Tradução não feita: ${decision.reason}.`;
  return `Tradução feita ${doneBy(decision.tool)} (${decision.reason}).`;
}

/** Especialista HeyGen: traduz o reel com voz e sincronia labial. */
export class HeygenTranslationSpecialist implements ProductionSpecialist {
  readonly kind = 'video_translation' as const;

  constructor(
    private readonly tools: ProductionTools,
    private readonly router: TranslationRouter,
  ) {}

  skipReason(context: ProductionContext) {
    return skipFor(this.router, context, 'heygen');
  }

  async run(context: ProductionContext, feedback: string | null): Promise<SpecialistResult> {
    const heygen = await this.tools.heygen();
    if (!heygen) throw new Error('HeyGen não conectado.');
    const language = heygenLanguageFor(context.market.locale, await heygen.languages());
    if (!language) throw new Error(`o HeyGen não traduz para ${context.market.locale}.`);
    // Sempre no modo rápido, como todo o hub (contexto do Sávio): no precisão a boca segue o idioma original nas pausas.
    const result = await heygen.translate({
      videoUrl: context.media.mediaUrls[0]!,
      outputLanguage: language,
      title: `Adaptação ${context.contentPieceId} r${context.revisionNumber}`,
      key: outputKey(context, 'video-heygen', 'mp4'),
    });
    const stored = await storeOutput(this.tools.media, this.tools.fetch, context, 'video-heygen', {
      url: result.videoUrl,
    });
    return {
      media: { mediaUrls: [stored.url], coverUrl: context.media.coverUrl },
      summary:
        `Vídeo traduzido para ${language} no modo rápido` +
        (feedback ? ' (refeito após o parecer do revisor)' : '') +
        (stored.stored ? '.' : ' — link temporário do HeyGen (armazenamento não configurado).'),
    };
  }
}

/** Especialista ElevenLabs: dubla o reel (voz traduzida, sem mexer na imagem). */
export class ElevenLabsDubbingSpecialist implements ProductionSpecialist {
  readonly kind = 'audio' as const;

  constructor(
    private readonly tools: ProductionTools,
    private readonly router: TranslationRouter,
  ) {}

  skipReason(context: ProductionContext) {
    return skipFor(this.router, context, 'elevenlabs');
  }

  async run(context: ProductionContext, feedback: string | null): Promise<SpecialistResult> {
    const elevenlabs = await this.tools.elevenlabs();
    if (!elevenlabs) throw new Error('ElevenLabs não conectada.');
    const target = isoLanguage(context.market.locale);
    const dubbed = await elevenlabs.dub({
      sourceUrl: context.media.mediaUrls[0]!,
      sourceLang: 'pt',
      targetLang: target,
      name: `Adaptação ${context.contentPieceId} r${context.revisionNumber}`,
    });
    const stored = await storeOutput(this.tools.media, this.tools.fetch, context, 'video-dublado', {
      body: dubbed.body,
      contentType: dubbed.contentType,
    });
    return {
      media: { mediaUrls: [stored.url], coverUrl: context.media.coverUrl },
      summary:
        `Vídeo dublado para ${context.market.locale} pela ElevenLabs` +
        (feedback ? ' (refeito após o parecer do revisor).' : '.'),
    };
  }
}

/**
 * Revisor da tradução: confere o arquivo e, com ElevenLabs e Claude conectados, transcreve o
 * original e o traduzido e compara (idioma, fidelidade, produto, cortes).
 */
export class TranslationReviewer implements ProductionReviewer {
  constructor(
    private readonly tools: ProductionTools,
    private readonly what: string,
  ) {}

  async review(context: ProductionContext, result: SpecialistResult) {
    const translated = result.media.mediaUrls[0];
    if (!translated) return { approved: false, notes: 'Nenhum vídeo foi gerado.' };
    const problem = await checkMediaLink(this.tools.fetch, translated, 'video', 'Vídeo traduzido');
    if (problem) return { approved: false, notes: problem };

    const [transcriber, judge] = await Promise.all([this.tools.transcriber(), this.tools.judge()]);
    if (!transcriber || !judge) {
      return {
        approved: true,
        notes:
          'Arquivo conferido. Revisão do conteúdo falado indisponível: conecte a IA (Claude) em Integrações.',
      };
    }
    const [originalTranscript, translatedTranscript] = await Promise.all([
      transcriber.transcribe(context.media.mediaUrls[0]!),
      transcriber.transcribe(translated),
    ]);
    return judge.compareTranscripts({
      locale: context.market.locale,
      productName: context.market.productName,
      originalTranscript,
      translatedTranscript,
      what: this.what,
    });
  }
}

/** As duas etapas de tradução do reel (só uma roda; a outra é pulada com o motivo). */
export function translationStages(tools: ProductionTools): ProductionStage[] {
  const router = new TranslationRouter(tools);
  return [
    {
      specialist: new HeygenTranslationSpecialist(tools, router),
      reviewer: new TranslationReviewer(tools, 'tradução de vídeo (HeyGen)'),
    },
    {
      specialist: new ElevenLabsDubbingSpecialist(tools, router),
      reviewer: new TranslationReviewer(tools, 'dublagem (ElevenLabs)'),
    },
  ];
}
