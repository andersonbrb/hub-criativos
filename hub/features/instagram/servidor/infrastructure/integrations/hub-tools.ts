import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';

import { entrada } from '@/features/edicoes/contrato';
import { iniciarEdicao } from '@/features/edicoes/servicos/rodar';
import { arquivoLocal, exigirDriveParaVideo } from '@/features/drive/servicos/videos';
import { FLORA_FAMILIES } from '@/lib/flora-models';
import type { Generation } from '@/lib/generations';
import { dublarVideo } from '@/lib/server/providers/elevenlabs';
import * as flora from '@/lib/server/providers/flora';
import { transcribeGeneration } from '@/lib/server/transcription';
import { refreshTranslation, runTranslation, translationLanguages } from '@/lib/server/video-translation';
import { createGeneration, getGeneration, updateGeneration } from '@/lib/server/store';
import { readFile } from 'node:fs/promises';

import type { MediaStorage } from '../../composition/media-storage';
import type { EditPlan } from '../video/edit-plan';
import { IntegrationCheckError } from './provider-checks';

// As ferramentas da linha de produção do Instagram feitas com o que o hub já tem (regra do pedido: o que o hub já
// integra é reaproveitado, sem segunda conexão): HeyGen, ElevenLabs e FLORA pelos logins das contas em Integrações,
// a transcrição do hub (Whisper, com o Scribe de reserva) e a edição pelo servidor de edições. Os links de mídia que
// chegam aqui são os da própria mídia do Instagram (MediaStorage), então cada arquivo é uma geração do hub.

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Geração dona do link (só links da mídia do Instagram). */
async function sourceOf(media: MediaStorage, url: string, what: string): Promise<Generation> {
  const generation = await media.generationOf(url);
  if (!generation?.file) throw new IntegrationCheckError(`${what} não está guardado no hub.`);
  return generation;
}

/** Espera uma geração do hub terminar (tradução, edição). */
async function waitGeneration(id: string, what: string, timeoutMs: number, refresh?: (g: Generation) => Promise<Generation>) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let generation = await getGeneration(id);
    if (!generation) throw new IntegrationCheckError(`A ${what} foi apagada no hub.`);
    if (refresh && generation.status !== 'done' && generation.status !== 'failed') generation = await refresh(generation);
    if (generation.status === 'done' && generation.file) return generation;
    if (generation.status === 'failed') throw new IntegrationCheckError(generation.error || `A ${what} falhou.`);
    if (Date.now() > deadline) throw new IntegrationCheckError(`A ${what} passou do tempo limite.`);
    await sleep(refresh ? 15_000 : 5_000);
  }
}

/** Tradução de vídeo do HeyGen pelo login do hub (sempre no modo rápido, como todo o hub: contexto do Sávio). */
export class HubHeygen {
  constructor(private readonly media: MediaStorage) {}

  languages(): Promise<string[]> {
    return translationLanguages();
  }

  async translate(input: { videoUrl: string; outputLanguage: string; title: string; key: string }): Promise<{ videoUrl: string; translationId: string }> {
    const source = await sourceOf(this.media, input.videoUrl, 'O vídeo a traduzir');
    const [created] = await runTranslation({ videoGenerationId: source.id, outputLanguages: [input.outputLanguage], title: input.title });
    if (!created) throw new IntegrationCheckError('O HeyGen não devolveu a tradução.');
    const done = await waitGeneration(created.id, 'tradução no HeyGen', 60 * 60_000, refreshTranslation);
    // O vídeo traduzido passa a ser mídia do Instagram (link permanente), sem baixar de novo.
    await updateGeneration(done.id, { tool: 'instagram', params: { ...done.params, instagramChave: input.key } });
    return { videoUrl: this.media.publicUrl(input.key), translationId: created.jobId ?? created.id };
  }
}

/** Dublagem do ElevenLabs (Dubbing v2) pelo login do hub. */
export class HubElevenLabs {
  constructor(private readonly media: MediaStorage) {}

  async dub(input: { sourceUrl: string; sourceLang: string; targetLang: string; name: string }): Promise<{ body: ArrayBuffer; contentType: string; dubbingId: string }> {
    const source = await sourceOf(this.media, input.sourceUrl, 'O vídeo a dublar');
    const local = await arquivoLocal(source.file!);
    const dubbed = await dublarVideo(await readFile(local), `${input.name}.mp4`, input.targetLang);
    return { body: dubbed.body, contentType: dubbed.contentType, dubbingId: dubbed.flowId };
  }
}

/** Transcrição do hub (Whisper no servidor de edições, ElevenLabs Scribe de reserva), com o tempo de cada palavra. */
export class HubTranscriber {
  constructor(private readonly media: MediaStorage) {}

  async transcribe(url: string): Promise<string> {
    return (await this.transcribeWords(url)).text;
  }

  async transcribeWords(url: string): Promise<{ text: string; words: { text: string; startMs: number; endMs: number }[] }> {
    const source = await sourceOf(this.media, url, 'O vídeo a transcrever');
    const transcript = await transcribeGeneration(source.id);
    return {
      text: transcript.text,
      words: (transcript.words ?? [])
        .map((w) => ({ text: w.text.trim(), startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000) }))
        .filter((w) => w.text.length > 0),
    };
  }
}

/** Modelo de edição de imagem do FLORA (imagem → imagem). */
export interface FloraImageModel {
  id: string;
  name: string;
  costUsd: number | null;
  seconds: number | null;
}

/** Nano Banana 2.1: o modelo que o Instagram já usava por padrão. */
const INSTAGRAM_DEFAULT_MODEL: FloraImageModel = { id: 'i2i-elote-gateway', name: 'Nano Banana 2.1', costUsd: null, seconds: null };

/** Edição de imagens do FLORA (slides e capas) pelo login do hub. */
export class HubFlora {
  constructor(
    private readonly media: MediaStorage,
    private readonly fetchFn: typeof fetch,
  ) {}

  /** Os modelos de imagem do estúdio de Geração que editam a partir de uma imagem, e o padrão do Instagram. */
  async imageEditModels(): Promise<FloraImageModel[]> {
    const models = FLORA_FAMILIES.filter((f) => f.kind === 'image' && f.fromImage).map((f) => ({
      id: f.fromImage,
      name: f.label,
      costUsd: f.baseCostUsd,
      seconds: null,
    }));
    return [INSTAGRAM_DEFAULT_MODEL, ...models.filter((m) => m.id !== INSTAGRAM_DEFAULT_MODEL.id)];
  }

  /** Edita a imagem conforme o pedido e espera ficar pronta. Devolve o link (temporário) do FLORA. */
  async editImage(input: { model: string; imageUrl: string; prompt: string }): Promise<string> {
    const response = await this.fetchFn(input.imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new IntegrationCheckError(`não foi possível abrir a imagem (${response.status}).`);
    const type = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
    const ext = type.split('/')[1] ?? 'jpg';
    const file = new File([await response.arrayBuffer()], `instagram.${ext}`, { type });
    const reference = await flora.uploadReference(file);
    const { run_id } = await flora.generate({ type: 'image', prompt: input.prompt, model: input.model, params: {}, references: [reference] });
    const deadline = Date.now() + 20 * 60_000;
    for (;;) {
      await sleep(15_000);
      const run = await flora.getRun(run_id);
      if (run.status === 'completed') {
        const url = run.outputs?.find((o) => o.type === 'imageUrl')?.url ?? run.outputs?.[0]?.url;
        if (!url) throw new IntegrationCheckError('O FLORA concluiu sem devolver a imagem.');
        return url;
      }
      if (run.status === 'failed') {
        throw new IntegrationCheckError(`O FLORA não conseguiu gerar a imagem: ${run.error_message ?? 'sem detalhe'}.`);
      }
      if (Date.now() > deadline) throw new IntegrationCheckError('A geração no FLORA passou do tempo limite.');
    }
  }
}

export interface VideoInfo {
  durationInSeconds: number;
  width: number;
  height: number;
}

/** Editor de vídeo: lê as medidas do vídeo, renderiza o plano de edição e tira quadros para os revisores. */
export interface VideoRenderer {
  probe(url: string): Promise<VideoInfo>;
  /** Renderiza e guarda como mídia do Instagram com `key`; devolve o link permanente. */
  render(plan: EditPlan, key: string): Promise<{ url: string }>;
  /** Quadros (JPEG em base64) do vídeo nos segundos pedidos, para a IA olhar. */
  frames(url: string, seconds: number[]): Promise<{ data: string; mediaType: 'image/jpeg' }[]>;
}

const FFMPEG = () => process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE = () => process.env.FFPROBE_BIN || 'ffprobe';

function run(bin: string, args: string[], encoding: 'utf8' | 'buffer'): Promise<string | Buffer> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { encoding, maxBuffer: 50 * 1024 * 1024, windowsHide: true, timeout: 120_000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

/**
 * O editor do reel no hub: medidas e quadros com o ffmpeg do sistema (leve, no próprio site) e a edição no servidor
 * de edições (features/edicoes, trabalho "instagram-reel"): o Remotion desenha os textos e o ffmpeg sobrepõe ao vídeo.
 * O vídeo editado vai para o Drive como toda edição do hub.
 */
export class HubVideoRenderer implements VideoRenderer {
  constructor(private readonly media: MediaStorage) {}

  async probe(url: string): Promise<VideoInfo> {
    const source = await sourceOf(this.media, url, 'O vídeo');
    const local = await arquivoLocal(source.file!);
    const out = String(
      await run(FFPROBE(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', local], 'utf8'),
    );
    const info = JSON.parse(out) as { streams?: { width?: number; height?: number }[]; format?: { duration?: string } };
    const durationInSeconds = Number(info.format?.duration) || 0;
    if (!durationInSeconds) throw new Error('não foi possível ler a duração do vídeo.');
    return { durationInSeconds, width: info.streams?.[0]?.width ?? 1080, height: info.streams?.[0]?.height ?? 1920 };
  }

  async frames(url: string, seconds: number[]) {
    const source = await sourceOf(this.media, url, 'O vídeo');
    const local = await arquivoLocal(source.file!);
    const frames: { data: string; mediaType: 'image/jpeg' }[] = [];
    for (const second of seconds) {
      const jpeg = (await run(
        FFMPEG(),
        ['-v', 'error', '-ss', Math.max(0, second).toFixed(2), '-i', local, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'],
        'buffer',
      )) as Buffer;
      if (!jpeg.length) throw new Error(`não saiu o quadro de ${second.toFixed(1)} s.`);
      frames.push({ data: jpeg.toString('base64'), mediaType: 'image/jpeg' });
    }
    return frames;
  }

  async render(plan: EditPlan, key: string): Promise<{ url: string }> {
    // O vídeo vai como entrada do trabalho; os textos e os tempos vão para a camada do Remotion.
    const { videoUrl, ...props } = plan;
    if (!videoUrl) throw new Error('Nenhum vídeo para editar.');
    const source = await sourceOf(this.media, videoUrl, 'O vídeo a editar');
    await exigirDriveParaVideo();
    const generation = await createGeneration({
      tool: 'instagram',
      kind: 'video',
      status: 'running',
      prompt: `Instagram: ${key}`,
      name: `Instagram · ${key.split('/').slice(-2).join(' · ')}`,
      params: { instagramChave: key },
    });
    await iniciarEdicao({
      id: generation.id,
      rotulo: 'Edição do reel',
      outName: `${randomBytes(16).toString('hex')}.mp4`,
      trabalho: { tipo: 'instagram-reel', dados: { video: entrada('video.mp4'), props } },
      arquivos: { 'video.mp4': source.file! },
    });
    await waitGeneration(generation.id, 'edição do reel', 60 * 60_000);
    return { url: this.media.publicUrl(key) };
  }
}
