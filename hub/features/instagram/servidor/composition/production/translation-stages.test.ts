import { EditingStandard, type ProductionContext, type SpecialistResult } from '@sbs/studio';
import type { ProductionOptions } from '@sbs/shared-kernel';
import { describe, expect, it, vi } from 'vitest';
import type {
  HubElevenLabs as ElevenLabsClient,
  HubHeygen as HeygenClient,
  HubTranscriber,
} from '../../infrastructure/integrations/hub-tools';
import type { MediaStorage } from '../media-storage';
import type { ProductionJudge } from './claude-judges';
import { heygenLanguageFor, isoLanguage } from './languages';
import {
  ElevenLabsDubbingSpecialist,
  HeygenTranslationSpecialist,
  TranslationReviewer,
  TranslationRouter,
  type ProductionTools,
} from './translation-stages';

const context = (
  options: Partial<ProductionOptions> = {},
  format: 'reel' | 'carousel' = 'reel',
): ProductionContext => ({
  contentPieceId: 'piece-1',
  referencePostId: 'ref-9',
  format,
  revisionNumber: 1,
  market: { marketId: 'm-fr', locale: 'fr-FR', productName: 'Saint Benoît' },
  suggestion: null,
  source: {
    caption: 'Oração',
    permalink: 'https://www.instagram.com/reel/X/',
    thumbnailUrl: 'https://midia.test/capa.jpg',
    mediaUrls: ['https://midia.test/video.mp4'],
  },
  media: { mediaUrls: ['https://midia.test/video.mp4'], coverUrl: 'https://midia.test/capa.jpg' },
  options: { videoTranslation: 'auto', heygenMode: 'speed', imageModel: null, ...options },
});

/** Links de mídia: tudo abre como vídeo, menos a capa (imagem). */
const mediaFetch = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  const type = url.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4';
  return new Response(new Uint8Array([7]), {
    status: url.includes('quebrado') ? 404 : 200,
    headers: { 'content-type': type, 'content-range': 'bytes 0-0/2048' },
  });
}) as unknown as typeof fetch;

function tools(
  overrides: {
    heygen?: Partial<HeygenClient> | null;
    elevenlabs?: Partial<ElevenLabsClient> | null;
    transcriber?: Partial<HubTranscriber> | null;
    judge?: Partial<ProductionJudge> | null;
    stored?: string[];
  } = {},
): ProductionTools {
  const stored = overrides.stored ?? [];
  const storage = {
    put: async (key: string) => {
      stored.push(key);
      return `https://plataforma.test/media/${key}`;
    },
  };
  return {
    heygen: async () =>
      overrides.heygen === undefined ? null : (overrides.heygen as HeygenClient),
    elevenlabs: async () =>
      overrides.elevenlabs === undefined ? null : (overrides.elevenlabs as ElevenLabsClient),
    transcriber: async () =>
      overrides.transcriber === undefined ? null : (overrides.transcriber as HubTranscriber),
    vmake: async () => null,
    flora: async () => null,
    judge: async () =>
      overrides.judge === undefined ? null : (overrides.judge as ProductionJudge),
    media: {
      resolve: async () => ({ storage, label: 'bucket' }),
    } as unknown as Pick<MediaStorage, 'resolve'>,
    fetch: mediaFetch,
    editing: async () => null,
    editingStandard: async () => {
      const s = EditingStandard.initial();
      return { guidelines: { ...s.guidelines }, style: { ...s.style } };
    },
    renderer: null,
  };
}

describe('idiomas', () => {
  const heygen = ['English', 'Spanish (Latin America)', 'Spanish (Spain)', 'French (France)'];

  it('acha o nome do HeyGen pelo locale do mercado', () => {
    expect(heygenLanguageFor('es-419', heygen)).toBe('Spanish (Latin America)');
    expect(heygenLanguageFor('fr-FR', heygen)).toBe('French (France)');
    expect(heygenLanguageFor('fr-CA', heygen)).toBe('French (France)');
    expect(heygenLanguageFor('de-DE', heygen)).toBeNull();
  });

  it('código ISO para a ElevenLabs', () => {
    expect(isoLanguage('es-419')).toBe('es');
    expect(isoLanguage('FR-fr')).toBe('fr');
  });
});

describe('TranslationRouter', () => {
  it('respeita a ferramenta escolhida na seleção', async () => {
    const router = new TranslationRouter(tools({ heygen: {}, elevenlabs: {} }));
    expect((await router.decide(context({ videoTranslation: 'elevenlabs' }))).tool).toBe(
      'elevenlabs',
    );
  });

  it('não troca a escolha por outra ferramenta quando ela não está conectada', async () => {
    const router = new TranslationRouter(tools({ elevenlabs: {} }));
    expect(await router.decide(context({ videoTranslation: 'heygen' }))).toEqual({
      tool: null,
      reason: 'HeyGen não conectado',
    });
  });

  it('no automático, narração sem rosto vai para a ElevenLabs', async () => {
    const speaksToCamera = vi.fn(async () => false);
    const router = new TranslationRouter(
      tools({ heygen: {}, elevenlabs: {}, judge: { speaksToCamera } }),
    );
    const decision = await router.decide(context());
    expect(decision.tool).toBe('elevenlabs');
    expect(decision.reason).toContain('narração');
    // Uma decisão por produção: a segunda etapa não pergunta de novo.
    await router.decide(context());
    expect(speaksToCamera).toHaveBeenCalledTimes(1);
  });

  it('no automático, usa a outra ferramenta se a preferida não estiver conectada', async () => {
    const router = new TranslationRouter(
      tools({ elevenlabs: {}, judge: { speaksToCamera: async () => true } }),
    );
    expect((await router.decide(context())).tool).toBe('elevenlabs');
  });
});

describe('especialistas de tradução', () => {
  it('HeyGen traduz (sempre no modo rápido, como o hub) e guarda o vídeo na plataforma', async () => {
    const translate = vi.fn(async () => ({
      videoUrl: 'https://heygen.test/out.mp4',
      translationId: 'vt-1',
    }));
    const stored: string[] = [];
    const t = tools({ heygen: { languages: async () => ['French (France)'], translate }, stored });
    const specialist = new HeygenTranslationSpecialist(t, new TranslationRouter(t));

    expect(await specialist.skipReason(context({ videoTranslation: 'heygen' }))).toBeNull();
    const result = await specialist.run(context({ videoTranslation: 'heygen' }), null);

    expect(translate).toHaveBeenCalledWith(
      expect.objectContaining({
        outputLanguage: 'French (France)',
        key: expect.stringMatching(/^pecas\/piece-1\/r1\/video-heygen-[0-9a-f]{8}\.mp4$/),
      }),
    );
    expect(stored[0]).toMatch(/^pecas\/piece-1\/r1\/video-heygen-[0-9a-f]{8}\.mp4$/);
    expect(result.media.mediaUrls[0]).toBe(`https://plataforma.test/media/${stored[0]}`);
    expect(result.summary).toContain('modo rápido');
  });

  it('HeyGen refaz depois da reprovação do revisor, ainda no modo rápido', async () => {
    const translate = vi.fn(async () => ({
      videoUrl: 'https://heygen.test/out.mp4',
      translationId: 'x',
    }));
    const t = tools({ heygen: { languages: async () => ['French (France)'], translate } });
    const specialist = new HeygenTranslationSpecialist(t, new TranslationRouter(t));
    const result = await specialist.run(context(), 'Faltou o trecho final.');
    expect(result.summary).toContain('modo rápido');
    expect(result.summary).toContain('refeito após o parecer do revisor');
  });

  it('a etapa da ferramenta não escolhida é pulada com o motivo', async () => {
    const t = tools({ heygen: {}, elevenlabs: {} });
    const router = new TranslationRouter(t);
    const dubbing = new ElevenLabsDubbingSpecialist(t, router);
    expect(await dubbing.skipReason(context({ videoTranslation: 'heygen' }))).toBe(
      'Tradução feita pelo HeyGen (escolhido na seleção do post).',
    );
    expect(await dubbing.skipReason(context({}, 'carousel'))).toBe(
      'Carrossel: não há vídeo para traduzir.',
    );
  });

  it('ElevenLabs dubla do português para o idioma do mercado', async () => {
    const dub = vi.fn(async () => ({
      body: new Uint8Array([1, 2]).buffer,
      contentType: 'video/mp4',
      dubbingId: 'dub-1',
    }));
    const t = tools({ elevenlabs: { dub } });
    const specialist = new ElevenLabsDubbingSpecialist(t, new TranslationRouter(t));
    const result = await specialist.run(context({ videoTranslation: 'elevenlabs' }), null);
    expect(dub).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLang: 'pt', targetLang: 'fr' }),
    );
    expect(result.media.mediaUrls[0]).toContain('/video-dublado-');
  });
});

describe('TranslationReviewer', () => {
  const result = (url: string): SpecialistResult => ({
    media: { mediaUrls: [url], coverUrl: null },
    summary: 'ok',
  });

  it('reprova quando o vídeo traduzido não abre', async () => {
    const review = await new TranslationReviewer(tools(), 'tradução').review(
      context(),
      result('https://midia.test/quebrado.mp4'),
    );
    expect(review).toEqual({ approved: false, notes: 'Vídeo traduzido: o link respondeu 404.' });
  });

  it('sem a IA (Claude), confere só o arquivo', async () => {
    const review = await new TranslationReviewer(tools(), 'tradução').review(
      context(),
      result('https://midia.test/traduzido.mp4'),
    );
    expect(review.approved).toBe(true);
    expect(review.notes).toContain('Revisão do conteúdo falado indisponível');
  });

  it('compara as transcrições do original e do traduzido', async () => {
    const transcribe = vi.fn(async (url: string) =>
      url.endsWith('/video.mp4') ? 'Oração a São Bento' : 'Prière à Saint Benoît',
    );
    const compareTranscripts = vi.fn(async () => ({ approved: false, notes: 'Faltou o amém.' }));
    const review = await new TranslationReviewer(
      tools({ transcriber: { transcribe }, judge: { compareTranscripts } }),
      'dublagem (ElevenLabs)',
    ).review(context(), result('https://midia.test/traduzido.mp4'));

    expect(review).toEqual({ approved: false, notes: 'Faltou o amém.' });
    expect(compareTranscripts).toHaveBeenCalledWith({
      locale: 'fr-FR',
      productName: 'Saint Benoît',
      originalTranscript: 'Oração a São Bento',
      translatedTranscript: 'Prière à Saint Benoît',
      what: 'dublagem (ElevenLabs)',
    });
  });
});
