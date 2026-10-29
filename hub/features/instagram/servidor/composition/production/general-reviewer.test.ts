import type { GeneralReviewInput } from '@sbs/governance';
import { EditingStandard } from '@sbs/studio';
import { describe, expect, it, vi } from 'vitest';
import type { VideoRenderer } from '../../infrastructure/integrations/hub-tools';
import type { MediaStorage } from '../media-storage';
import type { ProductionJudge, WholePiece } from './claude-judges';
import { ProductionGeneralReviewer } from './general-reviewer';
import type { ProductionTools } from './translation-stages';

const input = (assets: GeneralReviewInput['assets']): GeneralReviewInput => ({
  format: assets?.format ?? 'reel',
  caption: 'Oración a San Benito',
  hashtags: ['#sanbenito'],
  sourceCaption: 'Oração a São Bento',
  market: {
    locale: 'es-419',
    productName: 'San Benito',
    offerUrl: 'https://sanbenito.example.com',
    forbiddenTerms: [],
    glossary: [],
  },
  assets,
  production: [
    {
      step: 'Edição',
      status: 'approved',
      summary: 'Gancho adaptado',
      reviewNotes: 'ok',
      note: null,
    },
  ],
});

const imageFetch = vi.fn(async (url: string | URL | Request) =>
  String(url).includes('quebrada')
    ? new Response(null, { status: 404 })
    : new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } }),
) as unknown as typeof fetch;

function tools(judge: Partial<ProductionJudge> | null, renderer: VideoRenderer | null = null) {
  return {
    heygen: async () => null,
    elevenlabs: async () => null,
    transcriber: async () => null,
    vmake: async () => null,
    flora: async () => null,
    judge: async () => judge as ProductionJudge | null,
    editing: async () => null,
    editingStandard: async () => {
      const s = EditingStandard.initial();
      return { guidelines: { ...s.guidelines }, style: { ...s.style } };
    },
    renderer,
    media: { resolve: async () => null } as unknown as Pick<MediaStorage, 'resolve'>,
    fetch: imageFetch,
  } satisfies ProductionTools;
}

describe('ProductionGeneralReviewer', () => {
  it('sem IA conectada, não opina', async () => {
    const reviewer = new ProductionGeneralReviewer(tools(null));
    expect(await reviewer.review(input(null))).toBeNull();
  });

  it('reel: vê a capa e três quadros do vídeo final, sem textos novos por cima', async () => {
    const pieces: WholePiece[] = [];
    const renderer: VideoRenderer = {
      probe: async () => ({ durationInSeconds: 20, width: 1080, height: 1920 }),
      render: async () => {
        throw new Error('não usado');
      },
      frames: vi.fn(async (_url: string, seconds: number[]) =>
        seconds.map(() => ({ data: 'QUADRO', mediaType: 'image/jpeg' as const })),
      ),
    };
    const reviewer = new ProductionGeneralReviewer(
      tools(
        {
          reviewWhole: async (piece) => {
            pieces.push(piece);
            return { status: 'warn', message: 'O CTA chega tarde. Dá para aprovar.' };
          },
        },
        renderer,
      ),
    );

    const check = await reviewer.review(
      input({
        format: 'reel',
        videoUrl: 'https://midia.test/final.mp4',
        coverUrl: 'https://midia.test/capa.jpg',
      }),
    );

    expect(check).toEqual({
      code: 'general_review',
      label: 'Revisor geral',
      status: 'warn',
      blocking: false,
      message: 'O CTA chega tarde. Dá para aprovar.',
    });
    expect(pieces[0]!.images.map((i) => i.label)).toEqual([
      'Capa',
      'Vídeo em 3.0 s',
      'Vídeo em 10.0 s',
      'Vídeo em 18.0 s',
    ]);
    // Quadros do vídeo final como ele é (o editado já tem os textos).
    expect((renderer.frames as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual([3, 10, 18]);
    expect(pieces[0]!.production[0]!.step).toBe('Edição');
  });

  it('carrossel: vê os slides que abrem', async () => {
    const pieces: WholePiece[] = [];
    const reviewer = new ProductionGeneralReviewer(
      tools({
        reviewWhole: async (piece) => {
          pieces.push(piece);
          return { status: 'pass', message: 'Pronta para aprovar.' };
        },
      }),
    );
    await reviewer.review(
      input({
        format: 'carousel',
        slideUrls: [
          'https://midia.test/1.jpg',
          'https://midia.test/quebrada.jpg',
          'https://midia.test/3.jpg',
        ],
      }),
    );
    expect(pieces[0]!.images.map((i) => i.label)).toEqual(['Slide 1', 'Slide 3']);
  });
});
