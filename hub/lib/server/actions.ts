import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { applyRules, getFamily, paramsFor, type FloraFamily, type Operation } from "@/lib/flora-models";
import type { Generation } from "@/lib/generations";
import { getEditTool } from "@/lib/higgsfield-edits";
import { InputError } from "@/lib/server/http";
import { CONTENT_TYPES, downloadMedia, MEDIA_DIR, saveMedia } from "@/lib/server/media";
import { montageStatus } from "@/lib/server/montage";
import { textToSpeech } from "@/lib/server/providers/elevenlabs";
import { generate, getRun, getTarget, quote, uploadReference, type FloraReference } from "@/lib/server/providers/flora";
import { createVideo, getVideo, uploadAudio } from "@/lib/server/providers/heygen";
import { createEdit, DONE, FAILED, getJob } from "@/lib/server/providers/higgsfield";
import { createGeneration, getGeneration, updateGeneration } from "@/lib/server/store";

// Ações dos estúdios, compartilhadas entre as rotas da interface e as ferramentas do chat principal.
// Entrada inválida lança InputError (vira 400 na rota e erro legível para o agente).

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// ---------- ElevenLabs ----------

export type TtsRequest = {
  text: string;
  voiceId: string;
  voiceName?: string;
  modelId?: string;
  stability?: number;
  similarity?: number;
  style?: number;
  speed?: number;
};

export async function runTts(req: TtsRequest): Promise<Generation> {
  const text = String(req.text ?? "").trim();
  if (!text) throw new InputError("Escreva o texto da narração.");
  if (text.length > 5000) throw new InputError("Máximo de 5.000 caracteres por geração.");
  if (!req.voiceId) throw new InputError("Escolha uma voz.");

  // language_code só é aceito por alguns modelos; deixamos o ElevenLabs detectar o idioma.
  const input = {
    text,
    voiceId: String(req.voiceId),
    modelId: String(req.modelId || "eleven_multilingual_v2"),
    stability: clamp(req.stability, 0, 1, 0.5),
    similarity: clamp(req.similarity, 0, 1, 0.75),
    style: clamp(req.style, 0, 1, 0),
    speed: clamp(req.speed, 0.7, 1.2, 1),
  };

  const file = await saveMedia(await textToSpeech(input), "mp3");
  return createGeneration({
    tool: "elevenlabs",
    kind: "audio",
    status: "done",
    prompt: text,
    file,
    params: {
      voiceId: input.voiceId,
      voiceName: String(req.voiceName ?? ""),
      modelId: input.modelId,
      stability: input.stability,
      similarity: input.similarity,
      style: input.style,
      speed: input.speed,
    },
  });
}

// ---------- HeyGen ----------

export type AvatarRequest = {
  lookId: string;
  lookName?: string;
  aspectRatio?: string;
  resolution?: string;
} & ({ mode: "audio"; audioGenerationId: string } | { mode: "script"; script: string; voiceId: string; voiceName?: string });

export async function runAvatar(req: AvatarRequest): Promise<Generation> {
  const lookId = String(req.lookId ?? "");
  const aspectRatio = ["9:16", "1:1", "16:9", "4:5"].includes(String(req.aspectRatio)) ? String(req.aspectRatio) : "9:16";
  const resolution = ["720p", "1080p"].includes(String(req.resolution)) ? String(req.resolution) : "1080p";
  if (!lookId) throw new InputError("Escolha um avatar.");

  let videoId: string;
  let prompt: string;
  if (req.mode === "audio") {
    const audio = await getGeneration(String(req.audioGenerationId ?? ""));
    if (!audio?.file || audio.kind !== "audio") throw new InputError("Escolha uma narração do estúdio de Voz.");
    const audioAssetId = await uploadAudio(audio.file);
    prompt = audio.prompt;
    videoId = await createVideo({ lookId, aspectRatio, resolution, title: `Hub · ${prompt.slice(0, 40)}`, audioAssetId });
  } else {
    const script = String(req.script ?? "").trim();
    if (!script) throw new InputError("Escreva o roteiro.");
    if (!req.voiceId) throw new InputError("Escolha uma voz.");
    prompt = script;
    videoId = await createVideo({ lookId, aspectRatio, resolution, title: `Hub · ${script.slice(0, 40)}`, script, voiceId: String(req.voiceId) });
  }

  return createGeneration({
    tool: "heygen",
    kind: "video",
    status: "running",
    prompt,
    jobId: videoId,
    params: {
      lookId,
      lookName: String(req.lookName ?? ""),
      mode: req.mode === "audio" ? "audio" : "script",
      voiceName: req.mode === "script" ? String(req.voiceName ?? "") : "",
      aspect_ratio: aspectRatio,
      resolution,
    },
  });
}

// ---------- FLORA ----------

export type FloraRequest = {
  family: string;
  prompt: string;
  params?: Record<string, string>;
  count?: number;
  operation?: string;
  market?: string;
  // No máximo UMA referência (playbook COD: a foto do produto; duas enfraquecem o produto).
  referenceId?: string;
  image?: File | null;
  // Projeto do FLORA escolhido na conversa do chat; sem ele, o projeto padrão "Hub de Criativos".
  projectId?: string | null;
};

// Uma geração do hub vira referência: imagem do FLORA usa a URL dela; imagem local (anexo, outra ferramenta) é enviada ao FLORA.
// O nó do canvas só vale dentro do mesmo projeto; em outro projeto a imagem entra só pela URL.
async function referenceFromGeneration(id: string, projectId: string): Promise<FloraReference> {
  const ref = await getGeneration(id);
  if (!ref || ref.kind !== "image") throw new InputError("A referência precisa ser uma imagem do hub.");
  if (ref.tool === "flora" && ref.remoteUrl) {
    const sameProject = (ref.params.floraProjectId ?? (await getTarget()).projectId) === projectId;
    return { url: ref.remoteUrl, nodeId: sameProject && typeof ref.params.nodeId === "string" ? ref.params.nodeId : null };
  }
  if (!ref.file) throw new InputError("A imagem de referência ainda não está pronta.");
  const ext = ref.file.split(".").pop()!.toLowerCase();
  const bytes = await readFile(path.join(MEDIA_DIR, ref.file));
  return uploadReference(new File([bytes], ref.file, { type: CONTENT_TYPES[ext] ?? "image/png" }), projectId);
}

// Só os parâmetros da versão que vai rodar; valor fora das opções do modelo volta para o padrão.
function pickParams(family: FloraFamily, raw: Record<string, string> = {}, withImage: boolean) {
  const params: Record<string, string> = {};
  for (const p of paramsFor(family, withImage)) params[p.name] = p.options.some((o) => o.value === raw[p.name]) ? raw[p.name] : p.default;
  return params;
}

export async function runFlora(req: FloraRequest): Promise<Generation[]> {
  const family = getFamily(String(req.family ?? ""));
  if (!family) throw new InputError("Escolha um modelo.");
  const rawPrompt = String(req.prompt ?? "").trim();
  if (!rawPrompt) throw new InputError("Escreva o prompt.");
  const count = Math.min(4, Math.max(1, Number(req.count) || 1));

  const projectId = req.projectId || (await getTarget()).projectId;
  let reference: FloraReference | null = null;
  if (req.image instanceof File && req.image.size > 0) reference = await uploadReference(req.image, projectId);
  else if (req.referenceId) reference = await referenceFromGeneration(req.referenceId, projectId);
  const params = pickParams(family, req.params, Boolean(reference));

  const operation = (req.operation === "cod" ? "cod" : "none") as Operation;
  const prompt = applyRules(rawPrompt, family.kind, operation, String(req.market ?? ""));
  const model = reference ? family.fromImage : family.fromText;

  const generations: Generation[] = [];
  for (let i = 0; i < count; i++) {
    const run = await generate({ type: family.kind, prompt, model, params, reference, imageField: family.imageField, projectId });
    generations.push(
      await createGeneration({
        tool: "flora",
        kind: family.kind,
        status: "running",
        prompt: rawPrompt,
        jobId: run.run_id,
        params: {
          nodeId: run.node_id,
          floraProjectId: projectId,
          family: family.id,
          modelName: family.label,
          model,
          operation,
          finalPrompt: prompt,
          referenceUrl: reference?.url ?? null,
          cost: run.charged_cost ?? null,
          ...params,
        },
      }),
    );
  }
  return generations;
}

// Orçamento em dólar (não cobra). Com imagem ainda não enviada ao FLORA, usa o valor de referência da família.
export async function quoteFlora(req: {
  family: string;
  params?: Record<string, string>;
  count?: number;
  referenceId?: string;
  withImage?: boolean;
}): Promise<{ estimatedCost: number; approximate: boolean }> {
  const family = getFamily(String(req.family ?? ""));
  if (!family) throw new InputError("Modelo inválido.");
  const count = Math.min(4, Math.max(1, Number(req.count) || 1));
  const ref = req.referenceId ? await getGeneration(String(req.referenceId)) : undefined;
  const remoteRef = ref?.tool === "flora" ? ref.remoteUrl : undefined;
  const params = pickParams(family, req.params, Boolean(req.withImage || ref));
  const fallback = () => {
    const seconds = family.kind === "video" ? Number(params.duration) || 5 : 5;
    return { estimatedCost: family.baseCostUsd * (seconds / 5) * count, approximate: true };
  };

  if ((req.withImage || ref) && !remoteRef) return fallback();
  try {
    const cost = await quote({
      type: family.kind,
      prompt: "estimativa",
      model: remoteRef ? family.fromImage : family.fromText,
      params,
      reference: remoteRef ? { url: remoteRef, nodeId: null } : null,
      imageField: family.imageField,
    });
    return cost === null ? fallback() : { estimatedCost: cost * count, approximate: false };
  } catch {
    return fallback();
  }
}

// ---------- Higgsfield ----------

export type EditRequest = {
  tool: string;
  params?: Record<string, string>;
  prompt?: string;
  source: { generationId: string } | { path: string; label: string };
};

export async function runEdit(req: EditRequest): Promise<Generation> {
  const tool = getEditTool(String(req.tool ?? ""));
  if (!tool) throw new InputError("Escolha uma ferramenta de edição.");
  const prompt = String(req.prompt ?? "").trim();
  if (tool.prompt && !prompt) throw new InputError(`Preencha: ${tool.prompt.label}.`);

  const raw = req.params ?? {};
  const params: Record<string, string | number> = {};
  for (const f of tool.fields) {
    const v = raw[f.name] ?? f.default;
    params[f.name] = f.number ? Number(v) : v;
  }

  let videoPath: string;
  let sourceLabel: string;
  let sourceId: string | null = null;
  if ("generationId" in req.source) {
    const source = await getGeneration(req.source.generationId);
    if (!source?.file || source.kind !== "video") throw new InputError("Vídeo de origem não encontrado (precisa estar pronto).");
    videoPath = path.join(MEDIA_DIR, source.file);
    sourceLabel = source.prompt;
    sourceId = source.id;
  } else {
    videoPath = req.source.path;
    sourceLabel = req.source.label;
  }

  const job = await createEdit(tool, videoPath, params, prompt || undefined);
  return createGeneration({
    tool: "higgsfield",
    kind: "video",
    status: "running",
    prompt: prompt || `${tool.label}: ${sourceLabel}`,
    jobId: job.id,
    params: { edit: tool.id, editLabel: tool.label, source: sourceLabel, sourceId, ...params },
  });
}

// ---------- Status dos jobs ----------

// Consulta a ferramenta; quando o job termina, baixa o resultado para hub/.data/media.
export async function refreshGeneration(gen: Generation): Promise<Generation> {
  if (gen.tool === "montagem") return montageStatus(gen); // processo local, atualiza o próprio status
  if (!gen.jobId || gen.status === "done" || gen.status === "failed") return gen;
  const fail = async (error: string) => (await updateGeneration(gen.id, { status: "failed", error })) ?? gen;

  if (gen.tool === "flora") {
    const run = await getRun(gen.jobId);
    if (run.status === "completed") {
      const out = run.outputs?.find((o) => o.type === "videoUrl" || o.type === "imageUrl");
      if (!out) return fail("FLORA não devolveu mídia.");
      const file = await downloadMedia(out.url, out.type === "videoUrl" ? "mp4" : "png");
      const params = { ...gen.params, cost: run.charged_cost ?? gen.params.cost ?? null };
      return (await updateGeneration(gen.id, { status: "done", file, remoteUrl: out.url, params })) ?? gen;
    }
    if (run.status === "failed") return fail(run.error_message ?? "FLORA: falhou");
    return gen;
  }

  if (gen.tool === "heygen") {
    const video = await getVideo(gen.jobId);
    if (video.status === "completed" && video.url) {
      const file = await downloadMedia(video.url, "mp4");
      return (await updateGeneration(gen.id, { status: "done", file, remoteUrl: video.url })) ?? gen;
    }
    if (video.status === "failed") return fail(video.error ?? "HeyGen: falhou");
    return gen;
  }

  if (gen.tool === "higgsfield") {
    const job = await getJob(gen.jobId);
    if (DONE.has(job.status) && job.result_url) {
      const file = await downloadMedia(job.result_url, gen.kind === "video" ? "mp4" : "png");
      return (await updateGeneration(gen.id, { status: "done", file, remoteUrl: job.result_url })) ?? gen;
    }
    if (FAILED.has(job.status)) {
      return fail(job.status === "nsfw" ? "Bloqueado pelo filtro de conteúdo do Higgsfield." : `Higgsfield: ${job.status}`);
    }
    return gen;
  }

  return gen;
}
