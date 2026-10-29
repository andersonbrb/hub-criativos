import type {
  EditingStyle,
  ProductionContext,
  ProductionReviewer,
  ProductionSpecialist,
  ProductionStage,
  SpecialistResult,
} from '@sbs/studio';
import type { EditPlan } from '../../infrastructure/video/edit-plan';
import type { VideoInfo } from '../../infrastructure/integrations/hub-tools';
import {
  COPY_ROLES,
  type CopyProposal,
  type CopyRole,
  type DirectorCut,
  type EditingBrief,
} from './editing-agents';
import { checkMediaLink, outputKey } from './media-helpers';
import type { ProductionTools } from './translation-stages';

type Words = { text: string; startMs: number; endMs: number }[];

/**
 * Plano de edição a partir da decisão do diretor: gancho no início, CTA no fim, headline no
 * meio, legendas sincronizadas (se houver transcrição) e o estilo do Padrão de Edição.
 */
export function buildEditPlan(input: {
  videoUrl: string | null;
  video: VideoInfo;
  cut: DirectorCut;
  style: EditingStyle;
  words: Words;
}): EditPlan {
  const { video, cut, style } = input;
  const duration = video.durationInSeconds;
  const hookEnd = Math.min(3, duration * 0.25);
  const ctaStart = duration > 8 ? duration - 3.5 : duration * 0.75;
  const hook = cut.hook ? { text: cut.hook, endSecond: hookEnd } : null;
  const cta = style.showCtaCard && cut.cta ? { text: cut.cta, startSecond: ctaStart } : null;
  const headlineStart = hook ? hookEnd : 0;
  const headlineEnd = cta ? ctaStart : duration;
  return {
    videoUrl: input.videoUrl,
    width: video.width,
    height: video.height,
    fps: 30,
    durationInSeconds: duration,
    style: {
      font: style.font,
      textColor: style.textColor,
      highlightColor: style.highlightColor,
      captionsPosition: style.captionsPosition,
    },
    hook,
    headline:
      style.showHeadline && cut.headline && headlineEnd > headlineStart
        ? { text: cut.headline, startSecond: headlineStart, endSecond: headlineEnd }
        : null,
    cta,
    captions: style.showCaptions ? input.words : [],
    emphasis: cut.emphasis.map((word) => word.toLowerCase()),
  };
}

const ROLE_LABEL: Record<CopyRole, string> = {
  hook: 'Hook',
  body: 'Body',
  cta: 'CTA',
  headlines: 'Headlines/legendas',
};

function proposalLine(p: CopyProposal): string {
  const what =
    p.role === 'body'
      ? p.emphasis.length > 0
        ? `destaques: ${p.emphasis.join(', ')}`
        : 'sem destaques'
      : `"${p.text}"`;
  return `${ROLE_LABEL[p.role]} (${p.decision === 'keep' ? 'mantido' : 'adaptado'}): ${what} — ${p.rationale}`;
}

/** O que o diretor decidiu numa tentativa (o revisor da mesma tentativa usa). */
interface EditingSession {
  brief: EditingBrief;
  cut: DirectorCut;
  plan: EditPlan;
}

/**
 * Diretor de edição (Remotion): consulta os quatro especialistas de copy (Hook, Body, CTA,
 * Headlines/legendas), decide a edição final seguindo o Padrão de Edição e renderiza.
 */
export class EditingDirector implements ProductionSpecialist {
  readonly kind = 'editing' as const;

  constructor(
    private readonly tools: ProductionTools,
    private readonly sessions: Map<string, EditingSession>,
  ) {}

  async skipReason(context: ProductionContext): Promise<string | null> {
    if (context.format !== 'reel') return 'Carrossel: a edição de vídeo vale só para reels.';
    if (!this.tools.renderer) return 'Editor de vídeo (Remotion) indisponível neste servidor.';
    if (!(await this.tools.editing())) {
      return 'IA (Claude) não conectada: a edição precisa do diretor e dos especialistas de copy.';
    }
    return null;
  }

  async run(context: ProductionContext, feedback: string | null): Promise<SpecialistResult> {
    const agents = await this.tools.editing();
    const renderer = this.tools.renderer;
    if (!agents || !renderer) throw new Error('Edição indisponível.');
    const videoUrl = context.media.mediaUrls[0];
    if (!videoUrl) throw new Error('Nenhum vídeo para editar.');

    const [standard, video] = await Promise.all([
      this.tools.editingStandard(),
      renderer.probe(videoUrl),
    ]);
    let words: Words = [];
    let transcript = '';
    let captionsNote: string;
    const transcriber = await this.tools.transcriber();
    if (!transcriber) {
      captionsNote = 'sem legendas (transcrição indisponível neste servidor)';
    } else {
      try {
        const result = await transcriber.transcribeWords(videoUrl);
        words = result.words;
        transcript = result.text;
        captionsNote =
          words.length > 0 ? `${words.length} palavras sincronizadas` : 'sem fala detectada';
      } catch (error) {
        captionsNote = `sem legendas (transcrição falhou: ${error instanceof Error ? error.message : 'erro'})`;
      }
    }

    const brief: EditingBrief = {
      locale: context.market.locale,
      productName: context.market.productName,
      sourceCaption: context.source.caption,
      transcript,
      durationInSeconds: video.durationInSeconds,
      guidelines: standard.guidelines,
      feedback,
      request: context.suggestion,
    };
    const proposals = await Promise.all(COPY_ROLES.map((role) => agents.propose(role, brief)));
    const cut = await agents.direct(brief, proposals);
    const plan = buildEditPlan({ videoUrl, video, cut, style: standard.style, words });

    const rendered = await renderer.render(plan, outputKey(context, 'video-editado', 'mp4'));
    this.sessions.set(sessionKey(context), { brief, cut, plan: { ...plan, videoUrl } });

    return {
      media: { mediaUrls: [rendered.url], coverUrl: context.media.coverUrl },
      summary: [
        `Diretor de edição: ${cut.notes || 'edição montada a partir das propostas.'}`,
        ...proposals.map(proposalLine),
        `Legendas: ${captionsNote}.`,
        ...(feedback ? ['Refeito após o parecer do revisor de edição.'] : []),
      ].join('\n'),
    };
  }
}

/** Revisor de edição: confere o arquivo e olha quadros do gancho, do meio e do CTA. */
export class EditingReviewer implements ProductionReviewer {
  constructor(
    private readonly tools: ProductionTools,
    private readonly sessions: Map<string, EditingSession>,
  ) {}

  async review(context: ProductionContext, result: SpecialistResult) {
    const edited = result.media.mediaUrls[0];
    if (!edited) return { approved: false, notes: 'Nenhum vídeo editado foi gerado.' };
    const problem = await checkMediaLink(this.tools.fetch, edited, 'video', 'Vídeo editado');
    if (problem) return { approved: false, notes: problem };

    const session = this.sessions.get(sessionKey(context));
    const agents = await this.tools.editing();
    if (!session || !agents || !this.tools.renderer) {
      return { approved: true, notes: 'Arquivo conferido; revisão visual indisponível.' };
    }
    this.sessions.delete(sessionKey(context));
    const { plan, brief, cut } = session;
    const middle = plan.durationInSeconds / 2;
    const seconds = [
      plan.hook ? plan.hook.endSecond / 2 : 0.5,
      middle,
      plan.cta ? (plan.cta.startSecond + plan.durationInSeconds) / 2 : plan.durationInSeconds - 0.5,
    ];
    // Quadros do vídeo editado (com os textos que o servidor de edições aplicou).
    const frames = await this.tools.renderer.frames(edited, seconds);
    return agents.review(brief, cut, frames);
  }
}

const sessionKey = (context: ProductionContext) =>
  `${context.contentPieceId}:${context.revisionNumber}`;

export function editingStage(tools: ProductionTools): ProductionStage {
  const sessions = new Map<string, EditingSession>();
  return {
    specialist: new EditingDirector(tools, sessions),
    reviewer: new EditingReviewer(tools, sessions),
  };
}
