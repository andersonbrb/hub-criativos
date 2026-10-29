import type {
  ProductionContext,
  ProductionReviewer,
  ProductionSpecialist,
  ProductionStage,
  SpecialistResult,
} from '@sbs/studio';
import { checkMediaLink, storeOutput } from './media-helpers';
import type { VmakeClient } from '../../infrastructure/integrations/vmake-client';
import type { ProductionTools } from './translation-stages';
import { videoFrames } from './video-frames';

/** Momentos do vídeo que a IA olha para decidir e para revisar (frações da duração). */
const MOMENTS = [0.2, 0.5, 0.8];

/**
 * Vídeo sem legenda guardado por post de referência: o mesmo vídeo serve a todos os países,
 * então a vMake roda uma vez por post (a remoção inteligente tem o seu próprio arquivo).
 */
const sharedKey = (context: ProductionContext, smart: boolean) =>
  `referencias/${context.referencePostId}/${smart ? 'video-sem-texto' : 'video-sem-legenda'}.mp4`;

/** Remoções em andamento neste processo: duas peças do mesmo post esperam a mesma chamada. */
const inFlight = new Map<string, Promise<{ url: string; taskName: string }>>();

/**
 * Especialista de remoção de legendas (vMake): primeira etapa do reel, antes da tradução.
 * Antes de gastar cota, a IA olha quadros do vídeo; sem legendas, a etapa é pulada. O vídeo
 * limpo é reaproveitado pelos outros países do mesmo post. Na nova tentativa (revisor
 * reprovou), usa a remoção inteligente, que limpa qualquer texto na tela.
 */
export class SubtitleRemovalSpecialist implements ProductionSpecialist {
  readonly kind = 'subtitle_removal' as const;

  constructor(private readonly tools: ProductionTools) {}

  async skipReason(context: ProductionContext): Promise<string | null> {
    if (context.format !== 'reel') return 'Carrossel: não há vídeo para tirar legendas.';
    if (!(await this.tools.vmake())) {
      return 'vMake não conectada: o vídeo segue com as legendas originais.';
    }
    // Outro país do mesmo post já tirou as legendas: reaproveita, sem olhar o vídeo de novo.
    const resolved = await this.tools.media.resolve();
    if (resolved && (await resolved.storage.exists(sharedKey(context, false)))) return null;
    const [judge, renderer] = [await this.tools.judge(), this.tools.renderer];
    const video = context.media.mediaUrls[0];
    if (!judge || !renderer || !video) return null;
    try {
      const frames = await videoFrames(renderer, video, MOMENTS);
      if (!(await judge.hasBurnedText(frames))) {
        return 'O vídeo não tem legendas nem textos na tela: nada a remover (sem gastar cota da vMake).';
      }
    } catch {
      // Sem como olhar o vídeo: remove mesmo assim.
    }
    return null;
  }

  async run(context: ProductionContext, feedback: string | null): Promise<SpecialistResult> {
    const vmake = await this.tools.vmake();
    if (!vmake) throw new Error('vMake não conectada.');
    const source = context.media.mediaUrls[0];
    if (!source) throw new Error('Nenhum vídeo para tirar as legendas.');

    const smart = feedback !== null;
    const resolved = await this.tools.media.resolve();
    if (!resolved) {
      // Sem armazenamento não há como reaproveitar: remove só para esta peça.
      const result = await this.remove(vmake, source, smart);
      const stored = await storeOutput(
        this.tools.media,
        this.tools.fetch,
        context,
        'video-sem-legenda',
        {
          url: result.videoUrl,
        },
      );
      return this.result(context, stored.url, result.taskName, smart, false);
    }

    const key = sharedKey(context, smart);
    if (await resolved.storage.exists(key)) {
      return this.result(context, resolved.storage.publicUrl(key), null, smart, true);
    }
    let work = inFlight.get(key);
    const reused = work !== undefined;
    if (!work) {
      work = (async () => {
        const result = await this.remove(vmake, source, smart);
        const output = await this.tools.fetch(result.videoUrl, {
          signal: AbortSignal.timeout(300_000),
        });
        if (!output.ok) {
          throw new Error(`não foi possível baixar o vídeo da vMake (${output.status}).`);
        }
        const url = await resolved.storage.put(key, await output.arrayBuffer(), 'video/mp4');
        return { url, taskName: result.taskName };
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, work);
    }
    const done = await work;
    return this.result(context, done.url, reused ? null : done.taskName, smart, reused);
  }

  private async remove(vmake: VmakeClient, source: string, smart: boolean) {
    const response = await this.tools.fetch(source, { signal: AbortSignal.timeout(300_000) });
    if (!response.ok) throw new Error(`não foi possível baixar o vídeo (${response.status}).`);
    const contentType = (response.headers.get('content-type') ?? 'video/mp4').split(';')[0]!.trim();
    return vmake.removeSubtitles({ video: await response.arrayBuffer(), contentType, smart });
  }

  private result(
    context: ProductionContext,
    url: string,
    taskName: string | null,
    smart: boolean,
    reused: boolean,
  ): SpecialistResult {
    const summary = reused
      ? `Vídeo sem ${smart ? 'texto' : 'legenda'} reaproveitado: a vMake já tinha tratado este post para outro país (sem novo custo).`
      : `Legendas removidas na vMake (${taskName ?? 'vMake'})` +
        (smart ? ', com a remoção inteligente depois do parecer do revisor.' : '.');
    return { media: { mediaUrls: [url], coverUrl: context.media.coverUrl }, summary };
  }
}

/** Revisor da remoção: confere o arquivo e compara quadros antes/depois com a IA. */
export class SubtitleRemovalReviewer implements ProductionReviewer {
  constructor(private readonly tools: ProductionTools) {}

  async review(context: ProductionContext, result: SpecialistResult) {
    const cleaned = result.media.mediaUrls[0];
    if (!cleaned) return { approved: false, notes: 'Nenhum vídeo foi gerado.' };
    const problem = await checkMediaLink(this.tools.fetch, cleaned, 'video', 'Vídeo sem legendas');
    if (problem) return { approved: false, notes: problem };

    const [judge, renderer] = [await this.tools.judge(), this.tools.renderer];
    const original = context.media.mediaUrls[0];
    if (!judge || !renderer || !original) {
      return {
        approved: true,
        notes:
          'Arquivo conferido. Revisão visual indisponível: conecte a IA (Claude) em Integrações.',
      };
    }
    const [before, after] = await Promise.all([
      videoFrames(renderer, original, MOMENTS),
      videoFrames(renderer, cleaned, MOMENTS),
    ]);
    return judge.compareSubtitleRemoval(
      before.map((frame, index) => ({
        label: `Em ${frame.second.toFixed(1)} s`,
        before: frame,
        after: after[index] ?? frame,
      })),
    );
  }
}

export function subtitleStage(tools: ProductionTools): ProductionStage {
  return {
    specialist: new SubtitleRemovalSpecialist(tools),
    reviewer: new SubtitleRemovalReviewer(tools),
  };
}
