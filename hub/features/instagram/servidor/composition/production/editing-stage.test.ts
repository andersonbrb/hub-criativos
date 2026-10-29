import { EditingStandard, type ProductionContext } from '@sbs/studio';
import { describe, expect, it, vi } from 'vitest';
import type { EditPlan } from '../../infrastructure/video/edit-plan';
import type { HubTranscriber, VideoRenderer } from '../../infrastructure/integrations/hub-tools';
import type { MediaStorage } from '../media-storage';
import type { CopyRole, DirectorCut, EditingAgents } from './editing-agents';
import { buildEditPlan, editingStage } from './editing-stage';
import type { ProductionTools } from './translation-stages';

const context = (format: 'reel' | 'carousel' = 'reel'): ProductionContext => ({
  contentPieceId: 'piece-1',
  referencePostId: 'ref-9',
  format,
  revisionNumber: 2,
  market: { marketId: 'm-es', locale: 'es-419', productName: 'San Benito' },
  suggestion: null,
  source: {
    caption: 'Oração a São Bento pela família',
    permalink: 'https://www.instagram.com/reel/X/',
    thumbnailUrl: 'https://midia.test/capa.jpg',
    mediaUrls: ['https://midia.test/video.mp4'],
  },
  media: {
    mediaUrls: ['https://midia.test/traduzido.mp4'],
    coverUrl: 'https://midia.test/capa.jpg',
  },
  options: { videoTranslation: 'auto', heygenMode: 'speed', imageModel: null },
});

const cut: DirectorCut = {
  hook: '¿Sientes que nadie te escucha?',
  headline: 'Oración a San Benito',
  cta: 'Comenta AMÉN',
  emphasis: ['Familia'],
  notes: 'Gancho adaptado; CTA mantido.',
};

const style = () => ({ ...EditingStandard.initial().style });
const video = { durationInSeconds: 30, width: 1080, height: 1920 };

describe('buildEditPlan', () => {
  it('gancho no início, CTA nos 3,5 s finais e headline entre os dois', () => {
    const plan = buildEditPlan({ videoUrl: 'v.mp4', video, cut, style: style(), words: [] });
    expect(plan.hook).toEqual({ text: cut.hook, endSecond: 3 });
    expect(plan.cta).toEqual({ text: 'Comenta AMÉN', startSecond: 26.5 });
    expect(plan.headline).toEqual({ text: cut.headline, startSecond: 3, endSecond: 26.5 });
    expect(plan.emphasis).toEqual(['familia']);
  });

  it('respeita o que o Padrão de Edição desliga', () => {
    const words = [{ text: 'Hola', startMs: 0, endMs: 300 }];
    const plan = buildEditPlan({
      videoUrl: 'v.mp4',
      video,
      cut,
      style: { ...style(), showHeadline: false, showCtaCard: false, showCaptions: false },
      words,
    });
    expect(plan.headline).toBeNull();
    expect(plan.cta).toBeNull();
    expect(plan.captions).toEqual([]);
  });

  it('vídeo curto: gancho e CTA proporcionais', () => {
    const plan = buildEditPlan({
      videoUrl: null,
      video: { ...video, durationInSeconds: 8 },
      cut,
      style: style(),
      words: [],
    });
    expect(plan.hook?.endSecond).toBe(2);
    expect(plan.cta?.startSecond).toBe(6);
  });
});

/** Rede: tudo abre como vídeo. Armazenamento em memória. */
const okFetch = vi.fn(
  async () =>
    new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/4096' },
    }),
) as unknown as typeof fetch;

function setup(options: { review?: { approved: boolean; notes: string } } = {}) {
  const rendered: EditPlan[] = [];
  const stored: string[] = [];
  const renderer: VideoRenderer = {
    probe: vi.fn(async () => video),
    render: vi.fn(async (plan: EditPlan, key: string) => {
      rendered.push(plan);
      stored.push(key);
      return { url: `https://plataforma.test/media/${key}` };
    }),
    frames: vi.fn(async (_url: string, seconds: number[]) =>
      seconds.map(() => ({ data: 'AAAA', mediaType: 'image/jpeg' as const })),
    ),
  };
  const proposed: CopyRole[] = [];
  const agents: EditingAgents = {
    propose: vi.fn(async (role: CopyRole) => {
      proposed.push(role);
      return {
        role,
        decision: role === 'hook' ? ('adapt' as const) : ('keep' as const),
        text: role === 'body' ? '' : `texto ${role}`,
        emphasis: role === 'body' ? ['familia'] : [],
        rationale: `motivo ${role}`,
      };
    }),
    direct: vi.fn(async () => cut),
    review: vi.fn(async () => options.review ?? { approved: true, notes: 'Legível e no idioma.' }),
  };
  const transcriber = {
    transcribeWords: vi.fn(async () => ({
      text: 'Hola familia',
      words: [
        { text: 'Hola', startMs: 0, endMs: 400 },
        { text: 'familia', startMs: 400, endMs: 900 },
      ],
    })),
  };
  const tools: ProductionTools = {
    heygen: async () => null,
    elevenlabs: async () => null,
    transcriber: async () => transcriber as unknown as HubTranscriber,
    vmake: async () => null,
    flora: async () => null,
    judge: async () => null,
    editing: async () => agents,
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
        },
        label: 'bucket',
      }),
    } as unknown as Pick<MediaStorage, 'resolve'>,
    fetch: okFetch,
  };
  return { tools, agents, renderer, rendered, proposed, stored, transcriber };
}

describe('etapa de edição', () => {
  it('pula carrossel e quando a IA não está conectada', async () => {
    const { tools } = setup();
    const stage = editingStage(tools);
    expect(await stage.specialist.skipReason(context('carousel'))).toBe(
      'Carrossel: a edição de vídeo vale só para reels.',
    );
    const offline = editingStage({ ...tools, editing: async () => null });
    expect(await offline.specialist.skipReason(context())).toContain('IA (Claude) não conectada');
  });

  it('consulta os 4 especialistas, o diretor decide, renderiza e guarda o vídeo', async () => {
    const { tools, agents, rendered, proposed, stored, transcriber } = setup();
    const stage = editingStage(tools);

    const result = await stage.specialist.run(context(), null);

    expect(proposed.sort()).toEqual(['body', 'cta', 'headlines', 'hook']);
    expect(transcriber.transcribeWords).toHaveBeenCalledWith('https://midia.test/traduzido.mp4');
    expect(agents.direct).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: 'Hola familia', locale: 'es-419', feedback: null }),
      expect.any(Array),
    );
    expect(rendered[0]).toMatchObject({
      videoUrl: 'https://midia.test/traduzido.mp4',
      hook: { text: cut.hook },
      captions: [
        { text: 'Hola', startMs: 0, endMs: 400 },
        { text: 'familia', startMs: 400, endMs: 900 },
      ],
    });
    expect(stored[0]).toMatch(/^pecas\/piece-1\/r2\/video-editado-[0-9a-f]{8}\.mp4$/);
    expect(result.media.mediaUrls).toEqual([`https://plataforma.test/media/${stored[0]}`]);
    expect(result.summary.split('\n')).toEqual([
      'Diretor de edição: Gancho adaptado; CTA mantido.',
      'Hook (adaptado): "texto hook" — motivo hook',
      'Body (mantido): destaques: familia — motivo body',
      'CTA (mantido): "texto cta" — motivo cta',
      'Headlines/legendas (mantido): "texto headlines" — motivo headlines',
      'Legendas: 2 palavras sincronizadas.',
    ]);
  });

  it('o revisor olha quadros do gancho, do meio e do CTA', async () => {
    const { tools, renderer, agents } = setup({
      review: { approved: false, notes: 'O CTA cobre o rosto.' },
    });
    const stage = editingStage(tools);
    const result = await stage.specialist.run(context(), null);

    const review = await stage.reviewer!.review(context(), result);

    expect(review).toEqual({ approved: false, notes: 'O CTA cobre o rosto.' });
    // Quadros do vídeo editado (com os textos já aplicados pelo servidor de edições).
    expect(renderer.frames).toHaveBeenCalledWith(result.media.mediaUrls[0], [1.5, 15, 28.25]);
    expect(agents.review).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'es-419' }),
      cut,
      expect.arrayContaining([{ data: 'AAAA', mediaType: 'image/jpeg' }]),
    );
  });

  it('na nova tentativa, os especialistas recebem o parecer do revisor', async () => {
    const { tools, agents } = setup();
    await editingStage(tools).specialist.run(context(), 'O CTA cobre o rosto.');
    expect(agents.propose).toHaveBeenCalledWith(
      'cta',
      expect.objectContaining({ feedback: 'O CTA cobre o rosto.' }),
    );
  });
});
