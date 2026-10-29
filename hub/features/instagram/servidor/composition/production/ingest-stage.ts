import type {
  ProductionContext,
  ProductionReviewer,
  ProductionSpecialist,
  ProductionStage,
  SpecialistResult,
} from '@sbs/studio';
import type { MediaStorage } from '../media-storage';
import { checkMediaLink } from './media-helpers';

type Fetch = typeof fetch;

const EXTENSIONS: Record<string, string> = {
  'video/mp4': 'mp4',
  'image/jpeg': 'jpg',
  'video/quicktime': 'mov',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

/**
 * Especialista de armazenamento: copia a mídia original do post para o armazenamento da
 * plataforma (bucket do Railway), com link permanente — os links do
 * Instagram expiram. Guardada por post de referência: dois mercados do mesmo post
 * reaproveitam os mesmos arquivos.
 */
export class IngestSpecialist implements ProductionSpecialist {
  readonly kind = 'ingest' as const;

  constructor(
    private readonly media: Pick<MediaStorage, 'resolve'>,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async skipReason(): Promise<string | null> {
    return (await this.media.resolve())
      ? null
      : 'Armazenamento de mídia não configurado: a produção usa os links do Instagram, que expiram.';
  }

  async run(context: ProductionContext): Promise<SpecialistResult> {
    const resolved = await this.media.resolve();
    if (!resolved) throw new Error('Armazenamento de mídia não configurado.');
    const { storage, label } = resolved;

    const base = `referencias/${context.referencePostId}`;
    let copied = 0;
    let bytes = 0;
    const store = async (url: string, name: string) => {
      for (const ext of Object.values(EXTENSIONS)) {
        const key = `${base}/${name}.${ext}`;
        if (await storage.exists(key)) return storage.publicUrl(key);
      }
      const response = await this.fetchFn(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) {
        throw new Error(
          `o Instagram recusou o download (${response.status}). Sincronize a página de referência para renovar os links e tente de novo.`,
        );
      }
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      const ext =
        EXTENSIONS[contentType] ?? (context.format === 'reel' && name !== 'capa' ? 'mp4' : 'jpg');
      const body = await response.arrayBuffer();
      copied += 1;
      bytes += body.byteLength;
      return storage.put(`${base}/${name}.${ext}`, body, contentType || 'application/octet-stream');
    };

    const mediaUrls: string[] = [];
    for (const [index, url] of context.media.mediaUrls.entries()) {
      mediaUrls.push(await store(url, context.format === 'reel' ? 'video' : `slide-${index + 1}`));
    }
    const coverUrl = context.media.coverUrl ? await store(context.media.coverUrl, 'capa') : null;

    const total = mediaUrls.length + (coverUrl ? 1 : 0);
    return {
      media: { mediaUrls, coverUrl },
      summary:
        copied === 0
          ? `${total} ${total === 1 ? 'arquivo já estava guardado' : 'arquivos já estavam guardados'} no ${label}.`
          : `${copied} ${copied === 1 ? 'arquivo guardado' : 'arquivos guardados'} no ${label} (${(bytes / 1_048_576).toFixed(1)} MB).`,
    };
  }
}

/** Revisor técnico: cada link permanente abre, tem conteúdo e o tipo certo para o formato. */
export class IngestReviewer implements ProductionReviewer {
  constructor(private readonly fetchFn: Fetch = fetch) {}

  async review(context: ProductionContext, result: SpecialistResult) {
    const problems: string[] = [];
    const check = async (url: string, expected: 'video' | 'image', what: string) => {
      const problem = await checkMediaLink(this.fetchFn, url, expected, what);
      if (problem) problems.push(problem);
    };

    const expected = context.format === 'reel' ? 'video' : 'image';
    for (const [index, url] of result.media.mediaUrls.entries()) {
      await check(url, expected, context.format === 'reel' ? 'Vídeo' : `Slide ${index + 1}`);
    }
    if (result.media.coverUrl) await check(result.media.coverUrl, 'image', 'Capa');

    return problems.length === 0
      ? { approved: true, notes: 'Todos os arquivos abrem pelo link permanente, com o tipo certo.' }
      : { approved: false, notes: problems.join(' ') };
  }
}

export function ingestStage(
  media: Pick<MediaStorage, 'resolve'>,
  fetchFn: Fetch = fetch,
): ProductionStage {
  return {
    specialist: new IngestSpecialist(media, fetchFn),
    reviewer: new IngestReviewer(fetchFn),
  };
}
