import "server-only";

import path from "node:path";

import type { Generation } from "@/lib/generations";
import { callTool, uploadAsset } from "@/lib/server/heygen-mcp";
import { InputError } from "@/lib/server/http";
import { CONTENT_TYPES, downloadMedia, MEDIA_DIR } from "@/lib/server/media";
import { createGeneration, getGeneration, updateGeneration } from "@/lib/server/store";

// Tradução de vídeo do HeyGen (voz clonada + lipsync) pelo MCP do HeyGen: mesmas opções do app.
// Cada idioma de saída vira uma geração "heygen-traducao" acompanhada por refreshTranslation.

export type TranslateRequest = {
  // Vídeo do hub (gerado ou enviado no estúdio).
  videoGenerationId: string;
  outputLanguages: string[];
  mode?: "speed" | "precision";
  translateAudioOnly?: boolean;
  inputLanguage?: string | null;
  speakerNum?: number | null;
  enableDynamicDuration?: boolean;
  disableMusicTrack?: boolean;
  enableSpeechEnhancement?: boolean;
  enableWatermark?: boolean;
  keepTheSameFormat?: boolean;
  startTime?: number | null;
  endTime?: number | null;
  brandGlossaryId?: string | null;
  // Legenda .srt salva no hub (arquivo em .data/media) e a qual vídeo ela se aplica.
  srtFile?: string | null;
  srtRole?: "input" | "output" | null;
  // Áudio próprio para a dublagem (geração de áudio do hub, ex.: narração do ElevenLabs).
  audioGenerationId?: string | null;
  fpsMode?: "vfr" | "cfr" | "passthrough" | null;
  stockVoice?: boolean;
  title?: string;
};

const extOf = (file: string) => file.split(".").pop()!.toLowerCase();
const typeOf = (file: string) => (extOf(file) === "srt" ? "application/x-subrip" : (CONTENT_TYPES[extOf(file)] ?? "application/octet-stream"));
const asset = async (file: string) => ({ type: "asset_id", asset_id: await uploadAsset(path.join(MEDIA_DIR, file), file, typeOf(file)) });
const optNum = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

let languagesCache: { at: number; list: string[] } | null = null;

export async function translationLanguages(): Promise<string[]> {
  if (languagesCache && Date.now() - languagesCache.at < 6 * 3600_000) return languagesCache.list;
  const { languages } = await callTool<{ languages?: string[] }>("list_video_translation_languages");
  languagesCache = { at: Date.now(), list: languages ?? [] };
  return languagesCache.list;
}

export async function brandGlossaries(): Promise<{ id: string; name: string }[]> {
  const { items } = await callTool<{ items?: { brand_glossary_id: string; name: string }[] }>("list_brand_glossaries", { limit: 100 });
  return (items ?? []).map((g) => ({ id: g.brand_glossary_id, name: g.name }));
}

export async function runTranslation(req: TranslateRequest): Promise<Generation[]> {
  const source = await getGeneration(String(req.videoGenerationId ?? ""));
  if (!source?.file || source.kind !== "video" || source.status !== "done") throw new InputError("Escolha um vídeo pronto do hub.");
  const languages = [...new Set((req.outputLanguages ?? []).map(String).filter(Boolean))];
  if (!languages.length) throw new InputError("Escolha pelo menos um idioma de saída.");
  const valid = await translationLanguages();
  const unknown = languages.filter((l) => !valid.includes(l));
  if (unknown.length) {
    const words = unknown.map((l) => l.split(/[\s(]/)[0].toLowerCase());
    const close = valid.filter((v) => words.some((w) => w && v.toLowerCase().startsWith(w))).slice(0, 25);
    throw new InputError(`Idioma não aceito pelo HeyGen: ${unknown.join(", ")}.${close.length ? ` Parecidos: ${close.join(", ")}.` : ""}`);
  }
  const startTime = optNum(req.startTime);
  const endTime = optNum(req.endTime);
  if (startTime !== null && endTime !== null && endTime <= startTime) throw new InputError("O fim do trecho precisa ser depois do início.");

  let audioFile: string | null = null;
  if (req.audioGenerationId) {
    const audio = await getGeneration(String(req.audioGenerationId));
    if (!audio?.file || audio.kind !== "audio") throw new InputError("Áudio próprio não encontrado no hub.");
    audioFile = audio.file;
  }
  const srtFile = req.srtFile && extOf(req.srtFile) === "srt" ? req.srtFile : null;

  const mode = req.mode === "precision" ? "precision" : "speed";
  const title = String(req.title ?? "").trim() || `Hub · ${source.prompt.slice(0, 50)}`;
  const args: Record<string, unknown> = {
    video: await asset(source.file),
    outputLanguages: languages,
    mode,
    title,
    translateAudioOnly: Boolean(req.translateAudioOnly),
    enableDynamicDuration: req.enableDynamicDuration ?? true,
    disableMusicTrack: Boolean(req.disableMusicTrack),
    enableSpeechEnhancement: Boolean(req.enableSpeechEnhancement),
    enableWatermark: Boolean(req.enableWatermark),
  };
  if (req.keepTheSameFormat) args.keepTheSameFormat = true;
  if (req.inputLanguage) args.inputLanguage = String(req.inputLanguage);
  const speakers = optNum(req.speakerNum);
  if (speakers !== null) args.speakerNum = Math.min(10, Math.max(1, Math.round(speakers)));
  if (startTime !== null) args.startTime = Math.max(0, startTime);
  if (endTime !== null) args.endTime = endTime;
  if (req.brandGlossaryId) args.brandGlossaryId = String(req.brandGlossaryId);
  if (srtFile) {
    args.srt = await asset(srtFile);
    args.srtRole = req.srtRole === "output" ? "output" : "input";
  }
  if (audioFile) {
    args.audio = await asset(audioFile);
    if (req.fpsMode && ["vfr", "cfr", "passthrough"].includes(req.fpsMode)) args.fpsMode = req.fpsMode;
  }
  if (req.stockVoice) args.stockVoiceConfig = { use_stock_voice: true };

  const out = await callTool<{ video_translation_ids?: string[]; data?: { video_translation_ids?: string[] } }>("create_video_translation", args);
  const ids = out.video_translation_ids ?? out.data?.video_translation_ids ?? [];
  if (!ids.length) throw new Error("O HeyGen não devolveu o id da tradução.");

  const options = {
    sourceId: source.id,
    source: source.prompt.slice(0, 120),
    mode,
    translateAudioOnly: Boolean(req.translateAudioOnly),
    inputLanguage: req.inputLanguage ? String(req.inputLanguage) : null,
    speakerNum: (args.speakerNum as number | undefined) ?? null,
    enableDynamicDuration: args.enableDynamicDuration as boolean,
    disableMusicTrack: args.disableMusicTrack as boolean,
    enableSpeechEnhancement: args.enableSpeechEnhancement as boolean,
    enableWatermark: args.enableWatermark as boolean,
    keepTheSameFormat: Boolean(req.keepTheSameFormat),
    startTime,
    endTime,
    brandGlossaryId: req.brandGlossaryId ? String(req.brandGlossaryId) : null,
    srt: srtFile ? (args.srtRole as string) : null,
    customAudio: audioFile ? true : false,
    stockVoice: Boolean(req.stockVoice),
  };
  // Os ids vêm na ordem dos idiomas pedidos.
  return Promise.all(
    ids.map((id, i) =>
      createGeneration({
        tool: "heygen-traducao",
        kind: "video",
        status: "running",
        prompt: `${languages[i] ?? "Tradução"} · ${source.prompt}`,
        jobId: id,
        params: { language: languages[i] ?? null, ...options },
      }),
    ),
  );
}

type Detail = {
  status?: string;
  output_language?: string | null;
  video_url?: string | null;
  audio_url?: string | null;
  srt_caption_url?: string | null;
  failure_message?: string | null;
  duration?: number | null;
};

// Consulta a tradução; quando termina, baixa o vídeo (e a legenda .srt) para o hub.
export async function refreshTranslation(gen: Generation): Promise<Generation> {
  if (!gen.jobId || gen.status === "done" || gen.status === "failed") return gen;
  const raw = await callTool<Detail & { data?: Detail }>("get_video_translation", { videoTranslationId: gen.jobId });
  const d: Detail = raw.data ?? raw;
  if (d.status === "failed") return (await updateGeneration(gen.id, { status: "failed", error: d.failure_message ?? "HeyGen: a tradução falhou" })) ?? gen;
  if (d.status !== "completed") return gen;
  const url = d.video_url ?? d.audio_url;
  if (!url) return (await updateGeneration(gen.id, { status: "failed", error: "HeyGen não devolveu o vídeo traduzido." })) ?? gen;
  const file = await downloadMedia(url, d.video_url ? "mp4" : "mp3");
  const srtFile = d.srt_caption_url ? await downloadMedia(d.srt_caption_url, "srt").catch(() => null) : null;
  return (
    (await updateGeneration(gen.id, {
      status: "done",
      file,
      remoteUrl: url,
      kind: d.video_url ? "video" : "audio",
      params: { ...gen.params, srtFile, duration: d.duration ?? null, outputLanguage: d.output_language ?? gen.params.language ?? null },
    })) ?? gen
  );
}
