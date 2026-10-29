import type {
  ProductionContext,
  ProductionReviewer,
  ProductionSpecialist,
  ProductionStage,
  SpecialistResult,
} from '@sbs/studio';
import { checkMediaLink, directUrl, downloadImage, storeOutput } from './media-helpers';
import type { ProductionTools } from './translation-stages';

/** Modelo padrão da FLORA para adaptar imagens: Nano Banana 2.1 (bom com texto, barato). */
export const DEFAULT_IMAGE_MODEL = 'i2i-elote-gateway';
/** Imagens geradas ao mesmo tempo na FLORA. */
const PARALLEL = 3;

/** O que adaptar: os slides do carrossel ou a capa do reel. */
function targetsOf(context: ProductionContext): { label: string; name: string; url: string }[] {
  if (context.format === 'carousel') {
    return context.media.mediaUrls.map((url, index) => ({
      label: `Slide ${index + 1}`,
      name: `slide-${index + 1}`,
      url,
    }));
  }
  return context.media.coverUrl
    ? [{ label: 'Capa', name: 'capa', url: context.media.coverUrl }]
    : [];
}

/** Pedido de edição para o modelo (em inglês, que os modelos de imagem seguem melhor). */
export function imagePrompt(
  locale: string,
  productName: string,
  feedback: string | null,
  request: string | null = null,
): string {
  const language = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale) ?? locale;
  return [
    `Edit this image: translate every piece of visible text from Brazilian Portuguese into ${language} (${locale}).`,
    'Keep exactly the same layout, fonts, text sizes, colors, background, people and objects; change only the words.',
    `Write natural, correct ${language} with all accents. Wherever the text says "São Bento", write "${productName}".`,
    'Do not add new text, logos or watermarks. If the image has no text, return it unchanged.',
    ...(request ? [`The social media team asked for this change (top priority): ${request}`] : []),
    ...(feedback ? [`A reviewer rejected the previous version: ${feedback}`] : []),
  ].join(' ');
}

interface ImagesSession {
  originals: string[];
  edited: string[];
  /** Índices reprovados pelo revisor (só eles são refeitos). */
  failed: number[];
  model: string;
}

const sessionKey = (context: ProductionContext) =>
  `${context.contentPieceId}:${context.revisionNumber}`;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Especialista de imagens (FLORA): traduz o texto dos slides do carrossel ou da capa do reel
 * com o modelo escolhido na seleção, mantendo o design. Na nova tentativa, refaz só o que o
 * revisor reprovou.
 */
export class FloraImagesSpecialist implements ProductionSpecialist {
  readonly kind = 'images' as const;

  constructor(
    private readonly tools: ProductionTools,
    private readonly sessions: Map<string, ImagesSession>,
  ) {}

  async skipReason(context: ProductionContext): Promise<string | null> {
    if (targetsOf(context).length === 0) return 'Reel sem capa: não há imagem para adaptar.';
    if (!(await this.tools.flora())) {
      return 'FLORA não conectada: as imagens seguem com o texto original.';
    }
    return null;
  }

  async run(context: ProductionContext, feedback: string | null): Promise<SpecialistResult> {
    const flora = await this.tools.flora();
    if (!flora) throw new Error('FLORA não conectada.');
    const targets = targetsOf(context);
    const model = context.options.imageModel ?? DEFAULT_IMAGE_MODEL;
    const previous = feedback ? this.sessions.get(sessionKey(context)) : undefined;
    const redo = new Set(
      previous && previous.failed.length > 0 ? previous.failed : targets.map((_, i) => i),
    );
    const prompt = imagePrompt(
      context.market.locale,
      context.market.productName,
      feedback,
      context.suggestion,
    );

    const edited = await mapLimit(targets, PARALLEL, async (target) => {
      const index = targets.indexOf(target);
      if (!redo.has(index) && previous?.edited[index]) return previous.edited[index]!;
      const output = await flora.editImage({
        model,
        imageUrl: await directUrl(this.tools.fetch, target.url),
        prompt,
      });
      const stored = await storeOutput(this.tools.media, this.tools.fetch, context, target.name, {
        url: output,
      });
      return stored.url;
    });
    this.sessions.set(sessionKey(context), {
      originals: targets.map((t) => t.url),
      edited,
      failed: [],
      model,
    });

    const what =
      context.format === 'carousel'
        ? `${redo.size} de ${targets.length} ${targets.length === 1 ? 'slide' : 'slides'}`
        : 'Capa';
    return {
      media:
        context.format === 'carousel'
          ? { mediaUrls: edited, coverUrl: context.media.coverUrl }
          : { mediaUrls: context.media.mediaUrls, coverUrl: edited[0] ?? context.media.coverUrl },
      summary:
        `${what} ${context.format === 'carousel' ? 'adaptados' : 'adaptada'} na FLORA (modelo ${model}) para ${context.market.locale}` +
        (previous ? ', refazendo o que o revisor reprovou.' : '.'),
    };
  }
}

/**
 * Revisor de imagens: confere os arquivos e, com a IA conectada, compara cada imagem adaptada
 * com a original (texto traduzido, produto certo, design igual).
 */
export class ImagesReviewer implements ProductionReviewer {
  constructor(
    private readonly tools: ProductionTools,
    private readonly sessions: Map<string, ImagesSession>,
  ) {}

  async review(context: ProductionContext, result: SpecialistResult) {
    const session = this.sessions.get(sessionKey(context));
    const edited =
      context.format === 'carousel'
        ? result.media.mediaUrls
        : result.media.coverUrl
          ? [result.media.coverUrl]
          : [];
    if (!session || edited.length === 0) {
      return { approved: false, notes: 'Nenhuma imagem adaptada foi gerada.' };
    }
    const labels = edited.map((_, i) =>
      context.format === 'carousel' ? `Slide ${i + 1}` : 'Capa',
    );
    const problems: string[] = [];
    const broken: number[] = [];
    for (const [index, url] of edited.entries()) {
      const problem = await checkMediaLink(this.tools.fetch, url, 'image', labels[index]!);
      if (problem) {
        problems.push(problem);
        broken.push(index);
      }
    }
    if (problems.length > 0) {
      session.failed = broken;
      return { approved: false, notes: problems.join(' ') };
    }

    const judge = await this.tools.judge();
    if (!judge) {
      return {
        approved: true,
        notes:
          'Arquivos conferidos. Revisão visual indisponível: conecte a IA (Claude) em Integrações.',
      };
    }
    const pairs = await Promise.all(
      edited.map(async (url, index) => ({
        label: labels[index]!,
        original: await downloadImage(this.tools.fetch, session.originals[index]!),
        edited: await downloadImage(this.tools.fetch, url),
      })),
    );
    const verdict = await judge.compareImages({
      locale: context.market.locale,
      productName: context.market.productName,
      pairs,
    });
    session.failed = verdict.failed;
    if (verdict.approved) this.sessions.delete(sessionKey(context));
    return { approved: verdict.approved, notes: verdict.notes };
  }
}

export function imagesStage(tools: ProductionTools): ProductionStage {
  const sessions = new Map<string, ImagesSession>();
  return {
    specialist: new FloraImagesSpecialist(tools, sessions),
    reviewer: new ImagesReviewer(tools, sessions),
  };
}
