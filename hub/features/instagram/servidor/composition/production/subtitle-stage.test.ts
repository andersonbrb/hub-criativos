import { EditingStandard, type ProductionContext } from '@sbs/studio';
import { describe, expect, it, vi } from 'vitest';
import type { VmakeClient } from '../../infrastructure/integrations/vmake-client';
import type { VideoRenderer } from '../../infrastructure/integrations/hub-tools';
import type { MediaStorage } from '../media-storage';
import type { ProductionJudge } from './claude-judges';
import { subtitleStage } from './subtitle-stage';
import type { ProductionTools } from './translation-stages';

const context = (format: 'reel' | 'carousel' = 'reel'): ProductionContext => ({
  contentPieceId: 'piece-1',
  referencePostId: 'ref-9',
  format,
  revisionNumber: 1,
  market: { marketId: 'm-es', locale: 'es-419', productName: 'San Benito' },
  suggestion: null,
  source: {
    caption: 'Oração',
    permalink: 'https://www.instagram.com/reel/X/',
    thumbnailUrl: 'https://midia.test/capa.jpg',
    mediaUrls: ['https://midia.test/video.mp4'],
  },
  media: { mediaUrls: ['https://midia.test/video.mp4'], coverUrl: 'https://midia.test/capa.jpg' },
  options: { videoTranslation: 'auto', heygenMode: 'speed', imageModel: null },
});

const videoFetch = vi.fn(
  async () =>
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/4096' },
    }),
) as unknown as typeof fetch;

const renderer: VideoRenderer = {
  probe: async () => ({ durationInSeconds: 10, width: 1080, height: 1920 }),
  render: async () => {
    throw new Error('não usado');
  },
  frames: async (url, seconds) =>
    seconds.map(() => ({ data: url, mediaType: 'image/jpeg' as const })),
};

function setup(options: { judge?: Partial<ProductionJudge> | null; vmake?: boolean } = {}) {
  const removeSubtitles = vi.fn(async (input: { smart?: boolean }) => ({
    videoUrl: 'https://cdn.vmake.test/out.mp4',
    taskName: input.smart ? 'Smart - Video Smart Removal' : 'Subtitle - Remove Video Subtitles',
  }));
  const stored: string[] = [];
  const tools: ProductionTools = {
    heygen: async () => null,
    elevenlabs: async () => null,
    transcriber: async () => null,
    vmake: async () =>
      options.vmake === false ? null : ({ removeSubtitles } as unknown as VmakeClient),
    flora: async () => null,
    judge: async () => (options.judge ? (options.judge as ProductionJudge) : null),
    editing: async () => null,
    editingStandard: async () => {
      const s = EditingStandard.initial();
      return { guidelines: { ...s.guidelines }, style: { ...s.style } };
    },
    renderer,
    media: {
      resolve: async () => ({
        storage: {
          put: async (key: string) => {
            stored.push(key);
            return `https://plataforma.test/media/${key}`;
          },
          exists: async (key: string) => stored.includes(key),
          publicUrl: (key: string) => `https://plataforma.test/media/${key}`,
        },
        label: 'bucket',
      }),
    } as unknown as Pick<MediaStorage, 'resolve'>,
    fetch: videoFetch,
  };
  return { tools, removeSubtitles, stored };
}

describe('etapa de remoção de legendas (vMake)', () => {
  it('pula carrossel e quando a vMake não está conectada', async () => {
    const { tools } = setup({ vmake: false });
    const stage = subtitleStage(tools);
    expect(await stage.specialist.skipReason(context('carousel'))).toBe(
      'Carrossel: não há vídeo para tirar legendas.',
    );
    expect(await stage.specialist.skipReason(context())).toBe(
      'vMake não conectada: o vídeo segue com as legendas originais.',
    );
  });

  it('sem legendas no vídeo, pula sem gastar cota', async () => {
    const { tools, removeSubtitles } = setup({ judge: { hasBurnedText: async () => false } });
    const reason = await subtitleStage(tools).specialist.skipReason(context());
    expect(reason).toContain('nada a remover');
    expect(removeSubtitles).not.toHaveBeenCalled();
  });

  it('remove as legendas e guarda o vídeo; na nova tentativa usa a remoção inteligente', async () => {
    const { tools, removeSubtitles, stored } = setup({
      judge: { hasBurnedText: async () => true },
    });
    const stage = subtitleStage(tools);
    expect(await stage.specialist.skipReason(context())).toBeNull();

    const first = await stage.specialist.run(context(), null);
    expect(removeSubtitles.mock.calls[0]![0]).toMatchObject({
      contentType: 'video/mp4',
      smart: false,
    });
    expect(stored[0]).toBe('referencias/ref-9/video-sem-legenda.mp4');
    expect(first.media.mediaUrls[0]).toBe(`https://plataforma.test/media/${stored[0]}`);
    expect(first.summary).toBe('Legendas removidas na vMake (Subtitle - Remove Video Subtitles).');

    const second = await stage.specialist.run(context(), 'Sobrou legenda no fim.');
    expect(removeSubtitles.mock.calls[1]![0]).toMatchObject({ smart: true });
    expect(stored[1]).toBe('referencias/ref-9/video-sem-texto.mp4');
    expect(second.summary).toContain('remoção inteligente');
  });

  it('o outro país do mesmo post reaproveita o vídeo sem legenda, sem chamar a vMake de novo', async () => {
    const hasBurnedText = vi.fn(async () => true);
    const { tools, removeSubtitles } = setup({ judge: { hasBurnedText } });
    const es = context();
    const fr: ProductionContext = {
      ...context(),
      contentPieceId: 'piece-2',
      market: { marketId: 'm-fr', locale: 'fr-FR', productName: 'Saint Benoît' },
    };

    const first = await subtitleStage(tools).specialist.run(es, null);
    const stage = subtitleStage(tools);
    expect(await stage.specialist.skipReason(fr)).toBeNull();
    const second = await stage.specialist.run(fr, null);

    expect(removeSubtitles).toHaveBeenCalledOnce();
    expect(hasBurnedText).not.toHaveBeenCalled();
    expect(second.media.mediaUrls).toEqual(first.media.mediaUrls);
    expect(second.summary).toContain('reaproveitado');
  });

  it('dois países ao mesmo tempo esperam a mesma remoção', async () => {
    const { tools, removeSubtitles } = setup();
    const other = { ...context(), referencePostId: 'ref-10' };
    const [a, b] = await Promise.all([
      subtitleStage(tools).specialist.run(other, null),
      subtitleStage(tools).specialist.run({ ...other, contentPieceId: 'piece-2' }, null),
    ]);
    expect(removeSubtitles).toHaveBeenCalledOnce();
    expect(a.media.mediaUrls).toEqual(b.media.mediaUrls);
  });

  it('o revisor compara quadros antes e depois nos mesmos momentos', async () => {
    const compareSubtitleRemoval = vi.fn(async (_pairs: unknown) => ({
      approved: false,
      notes: 'Em 5.0 s sobrou parte da legenda.',
    }));
    const { tools } = setup({ judge: { compareSubtitleRemoval } });
    const stage = subtitleStage(tools);
    const result = await stage.specialist.run(context(), null);

    const review = await stage.reviewer!.review(context(), result);

    expect(review).toEqual({ approved: false, notes: 'Em 5.0 s sobrou parte da legenda.' });
    const pairs = compareSubtitleRemoval.mock.calls[0]![0] as unknown as {
      label: string;
      before: { data: string };
      after: { data: string };
    }[];
    expect(pairs.map((p) => p.label)).toEqual(['Em 2.0 s', 'Em 5.0 s', 'Em 8.0 s']);
    expect(pairs[0]!.before.data).toBe('https://midia.test/video.mp4');
    expect(pairs[0]!.after.data).toBe(result.media.mediaUrls[0]);
  });
});
