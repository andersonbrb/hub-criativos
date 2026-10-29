import { EditingStandard, type ProductionContext } from '@sbs/studio';
import { describe, expect, it, vi } from 'vitest';
import type { HubFlora as FloraClient } from '../../infrastructure/integrations/hub-tools';
import type { MediaStorage } from '../media-storage';
import type { ImageComparison, ProductionJudge } from './claude-judges';
import { DEFAULT_IMAGE_MODEL, imagePrompt, imagesStage } from './images-stage';
import type { ProductionTools } from './translation-stages';

const carousel = (imageModel: string | null = null): ProductionContext => ({
  contentPieceId: 'piece-1',
  referencePostId: 'ref-9',
  format: 'carousel',
  revisionNumber: 1,
  market: { marketId: 'm-fr', locale: 'fr-FR', productName: 'Saint Benoît' },
  suggestion: null,
  source: {
    caption: 'Oração',
    permalink: 'https://www.instagram.com/p/X/',
    thumbnailUrl: 'https://midia.test/s1.jpg',
    mediaUrls: ['https://midia.test/s1.jpg', 'https://midia.test/s2.jpg'],
  },
  media: {
    mediaUrls: ['https://midia.test/s1.jpg', 'https://midia.test/s2.jpg'],
    coverUrl: 'https://midia.test/s1.jpg',
  },
  options: { videoTranslation: 'auto', heygenMode: 'speed', imageModel },
});

const reel = (): ProductionContext => ({
  ...carousel(),
  format: 'reel',
  media: { mediaUrls: ['https://midia.test/editado.mp4'], coverUrl: 'https://midia.test/capa.jpg' },
});

/** Toda imagem abre como JPEG. */
const imageFetch = vi.fn(
  async () =>
    new Response(new Uint8Array([1, 2]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/2048' },
    }),
) as unknown as typeof fetch;

function setup(options: { judge?: Partial<ProductionJudge> | null } = {}) {
  let n = 0;
  const editImage = vi.fn(async (_input: { model: string; imageUrl: string; prompt: string }) => {
    n += 1;
    return `https://media.flora.ai/out-${n}.png`;
  });
  const stored: string[] = [];
  const tools: ProductionTools = {
    heygen: async () => null,
    elevenlabs: async () => null,
    transcriber: async () => null,
    vmake: async () => null,
    flora: async () => ({ editImage }) as unknown as FloraClient,
    judge: async () => (options.judge ? (options.judge as ProductionJudge) : null),
    editing: async () => null,
    editingStandard: async () => {
      const s = EditingStandard.initial();
      return { guidelines: { ...s.guidelines }, style: { ...s.style } };
    },
    renderer: null,
    media: {
      resolve: async () => ({
        storage: {
          put: async (key: string) => {
            stored.push(key);
            return `https://plataforma.test/media/${key}`;
          },
        },
        label: 'bucket',
      }),
    } as unknown as Pick<MediaStorage, 'resolve'>,
    fetch: imageFetch,
  };
  return { tools, editImage, stored };
}

describe('imagePrompt', () => {
  it('pede a tradução no idioma do mercado com o nome do produto', () => {
    const prompt = imagePrompt('fr-FR', 'Saint Benoît', null);
    expect(prompt).toContain('into French (France) (fr-FR)');
    expect(prompt).toContain('"São Bento", write "Saint Benoît"');
    expect(imagePrompt('fr-FR', 'X', 'Slide 2 com erro')).toContain(
      'A reviewer rejected the previous version: Slide 2 com erro',
    );
  });
});

describe('etapa de imagens (FLORA)', () => {
  it('sem FLORA, pula com o motivo', async () => {
    const { tools } = setup();
    const stage = imagesStage({ ...tools, flora: async () => null });
    expect(await stage.specialist.skipReason(carousel())).toBe(
      'FLORA não conectada: as imagens seguem com o texto original.',
    );
  });

  it('carrossel: adapta cada slide com o modelo escolhido e guarda na plataforma', async () => {
    const { tools, editImage, stored } = setup();
    const result = await imagesStage(tools).specialist.run(carousel('i2i-ideogram'), null);

    expect(editImage).toHaveBeenCalledTimes(2);
    expect(editImage.mock.calls[0]![0]).toMatchObject({
      model: 'i2i-ideogram',
      imageUrl: 'https://midia.test/s1.jpg',
    });
    expect(stored.map((k) => k.replace(/-[0-9a-f]{8}\./, '.'))).toEqual([
      'pecas/piece-1/r1/slide-1.jpeg',
      'pecas/piece-1/r1/slide-2.jpeg',
    ]);
    expect(result.media.mediaUrls).toHaveLength(2);
    expect(result.summary).toBe(
      '2 de 2 slides adaptados na FLORA (modelo i2i-ideogram) para fr-FR.',
    );
  });

  it('reel: adapta só a capa, com o modelo padrão', async () => {
    const { tools, editImage } = setup();
    const result = await imagesStage(tools).specialist.run(reel(), null);
    expect(editImage).toHaveBeenCalledTimes(1);
    expect(editImage.mock.calls[0]![0]).toMatchObject({
      model: DEFAULT_IMAGE_MODEL,
      imageUrl: 'https://midia.test/capa.jpg',
    });
    expect(result.media.mediaUrls).toEqual(['https://midia.test/editado.mp4']);
    expect(result.media.coverUrl).toMatch(/\/pecas\/piece-1\/r1\/capa-/);
  });

  it('o revisor compara original e adaptada; na nova tentativa só o slide reprovado é refeito', async () => {
    const compareImages = vi.fn(async (_input: ImageComparison) => ({
      approved: false,
      notes: 'Slide 2: sobrou "Oração" em português.',
      failed: [1],
    }));
    const { tools, editImage } = setup({ judge: { compareImages } });
    const stage = imagesStage(tools);

    const first = await stage.specialist.run(carousel(), null);
    const review = await stage.reviewer!.review(carousel(), first);
    expect(review).toEqual({ approved: false, notes: 'Slide 2: sobrou "Oração" em português.' });
    expect(compareImages.mock.calls[0]![0].pairs.map((p) => p.label)).toEqual([
      'Slide 1',
      'Slide 2',
    ]);

    const second = await stage.specialist.run(carousel(), review.notes);
    expect(editImage).toHaveBeenCalledTimes(3);
    expect(editImage.mock.calls[2]![0].imageUrl).toBe('https://midia.test/s2.jpg');
    expect(second.media.mediaUrls[0]).toBe(first.media.mediaUrls[0]);
    expect(second.media.mediaUrls[1]).not.toBe(first.media.mediaUrls[1]);
    expect(second.summary).toContain('1 de 2 slides');
  });

  it('sem IA, confere só os arquivos', async () => {
    const { tools } = setup();
    const stage = imagesStage(tools);
    const result = await stage.specialist.run(carousel(), null);
    const review = await stage.reviewer!.review(carousel(), result);
    expect(review.approved).toBe(true);
    expect(review.notes).toContain('Revisão visual indisponível');
  });
});
