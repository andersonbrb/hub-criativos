import type { CreativeResult, CreativeStudio, ProduceCreativeInput } from '../../application';

export type FakeCreativeStudioMode = 'completed' | 'pending' | 'fail';

export interface FakeCreativeStudioOptions {
  mode?: FakeCreativeStudioMode;
  failureMessage?: string;
}

/**
 * Plataforma de criativos falsa e determinística. Cada chamada para a mesma peça conta
 * como uma nova versão (`rev`), para os links mudarem entre revisões na demo.
 */
export class FakeCreativeStudio implements CreativeStudio {
  readonly requests: ProduceCreativeInput[] = [];
  private readonly productions = new Map<string, number>();
  private mode: FakeCreativeStudioMode;
  private readonly failureMessage: string;

  constructor(options: FakeCreativeStudioOptions = {}) {
    this.mode = options.mode ?? 'completed';
    this.failureMessage = options.failureMessage ?? 'A plataforma de criativos não respondeu.';
  }

  /** Permite simular, por exemplo, uma falha seguida de uma nova tentativa com sucesso. */
  setMode(mode: FakeCreativeStudioMode): void {
    this.mode = mode;
  }

  async produce(input: ProduceCreativeInput): Promise<CreativeResult> {
    this.requests.push(input);
    if (this.mode === 'fail') throw new Error(this.failureMessage);

    const rev = (this.productions.get(input.contentPieceId) ?? 0) + 1;
    this.productions.set(input.contentPieceId, rev);
    if (this.mode === 'pending') {
      return { status: 'pending', jobId: `fake-creative-${input.contentPieceId}-${rev}` };
    }

    const locale = input.targetLocale.toLowerCase();
    if (input.format === 'reel') {
      const [video] = input.sourceMediaUrls;
      if (!video) throw new Error('O post de referência não tem vídeo para adaptar.');
      const url = new URL(video);
      url.searchParams.set('locale', input.targetLocale);
      url.searchParams.set('rev', String(rev));
      return {
        status: 'completed',
        assets: {
          format: 'reel',
          videoUrl: url.toString(),
          coverUrl: `https://picsum.photos/seed/${hash(video)}r${rev}-${locale}/1080/1920`,
        },
      };
    }

    return {
      status: 'completed',
      assets: {
        format: 'carousel',
        slideUrls: input.sourceMediaUrls.map(
          (url, i) => `https://picsum.photos/seed/${hash(url)}s${i + 1}r${rev}-${locale}/1080/1350`,
        ),
      },
    };
  }
}

/** djb2 em base 36: semente curta e estável para o picsum. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
