import "server-only";

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import type { Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { downloadMedia, MEDIA_DIR } from "@/lib/server/media";
import { listProjectMedia } from "@/lib/server/providers/flora";
import { createGeneration, DATA_DIR, getGeneration, listGenerations } from "@/lib/server/store";
import { transcribeGeneration, type Engine, type Transcript } from "@/lib/server/transcription";

// "Assistir" vídeos para os agentes: ficha técnica, cortes de cena, quadros-chave e transcrição.
// Tudo local (ffmpeg + Whisper) e em cache por geração em hub/.data/analysis/<id>.json,
// junto com a decupagem que um agente salvar: qualquer agente reaproveita sem pagar de novo.

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";
const DIR = path.join(DATA_DIR, "analysis");

export type VideoMeta = { duration: number; width: number; height: number; fps: number | null; hasAudio: boolean };

export type Analysis = {
  meta?: VideoMeta;
  cuts?: number[]; // segundos em que a cena muda
  transcript?: Transcript;
  noSpeech?: string; // motivo quando não há fala para transcrever
  notes?: string; // decupagem/descrição salva por um agente (hub_save_analysis)
  notesAt?: string;
};

function run(bin: string, args: string[], timeout = 180_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout, maxBuffer: 50 * 1024 * 1024, windowsHide: true, encoding: "utf8" }, (err, stdout, stderr) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return reject(new Error(`${bin} não encontrado. Instale o ffmpeg ou defina FFMPEG_BIN/FFPROBE_BIN no .env.local.`));
        return reject(new Error(`${path.basename(bin)}: ${(stderr || err.message).trim().split("\n").slice(-3).join(" ")}`));
      }
      resolve({ stdout, stderr });
    });
    child.stdin?.end();
  });
}

const exists = (file: string) => access(file).then(() => true, () => false);
const analysisFile = (id: string) => path.join(DIR, `${id.replace(/[^\w-]/g, "")}.json`);

export async function getAnalysis(id: string): Promise<Analysis> {
  try {
    return JSON.parse(await readFile(analysisFile(id), "utf8")) as Analysis;
  } catch {
    return {};
  }
}

export async function patchAnalysis(id: string, patch: Partial<Analysis>): Promise<Analysis> {
  const next = { ...(await getAnalysis(id)), ...patch };
  await mkdir(DIR, { recursive: true });
  const tmp = `${analysisFile(id)}.tmp`;
  await writeFile(tmp, JSON.stringify(next));
  await rename(tmp, analysisFile(id));
  return next;
}

export async function readyMedia(id: string, kinds: Generation["kind"][] = ["video"]): Promise<Generation & { file: string }> {
  const g = await getGeneration(id);
  if (!g) throw new InputError(`Geração não encontrada: ${id}.`);
  if (!kinds.includes(g.kind)) throw new InputError(`A geração ${id} é ${g.kind}, não ${kinds.join("/")}.`);
  if (g.status !== "done" || !g.file) throw new InputError(`A geração ${id} ainda não está pronta.`);
  return g as Generation & { file: string };
}

async function probe(file: string): Promise<VideoMeta> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path.join(MEDIA_DIR, file)]);
  const data = JSON.parse(stdout) as {
    streams?: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }[];
    format?: { duration?: string };
  };
  const v = data.streams?.find((s) => s.codec_type === "video");
  const [num, den] = (v?.avg_frame_rate ?? "").split("/").map(Number);
  return {
    duration: Number(data.format?.duration ?? v?.duration ?? 0) || 0,
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: num && den ? Math.round((num / den) * 100) / 100 : null,
    hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
  };
}

// Mudança de cena pelo filtro scene do ffmpeg (em baixa resolução: rápido).
async function detectCuts(file: string): Promise<number[]> {
  const { stderr } = await run(FFMPEG, [
    "-hide_banner", "-nostats", "-i", path.join(MEDIA_DIR, file), "-an",
    "-vf", "scale=320:-2,select='gt(scene,0.3)',showinfo", "-f", "null", "-",
  ]);
  const times = [...stderr.matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100);
  return times.filter((t, i) => t > 0.2 && (i === 0 || t - times[i - 1] > 0.25));
}

// Ficha técnica + cortes, calculados uma vez por vídeo.
export async function videoInfo(g: Generation & { file: string }): Promise<{ meta: VideoMeta; cuts: number[] }> {
  const a = await getAnalysis(g.id);
  if (a.meta && a.cuts) return { meta: a.meta, cuts: a.cuts };
  const meta = a.meta ?? (await probe(g.file));
  const cuts = a.cuts ?? (await detectCuts(g.file).catch(() => []));
  await patchAnalysis(g.id, { meta, cuts });
  return { meta, cuts };
}

// Transcrição em cache. auto = Whisper local (grátis) primeiro; ElevenLabs Scribe só se o local falhar.
export async function transcriptOf(id: string, engine: Engine = "auto"): Promise<{ transcript: Transcript | null; noSpeech?: string; cached: boolean }> {
  const a = await getAnalysis(id);
  if (a.transcript && (engine === "auto" || a.transcript.engine === engine)) return { transcript: a.transcript, cached: true };
  if (a.noSpeech && engine === "auto") return { transcript: null, noSpeech: a.noSpeech, cached: true };
  let transcript: Transcript;
  try {
    if (engine !== "auto") transcript = await transcribeGeneration(id, engine);
    else {
      try {
        transcript = await transcribeGeneration(id, "local");
      } catch (local) {
        if (local instanceof InputError) throw local;
        try {
          transcript = await transcribeGeneration(id, "elevenlabs");
        } catch (remote) {
          throw new Error(`Whisper local: ${(local as Error).message} · ElevenLabs: ${(remote as Error).message}`);
        }
      }
    }
  } catch (err) {
    // Sem trilha de áudio: guarda o motivo para não tentar de novo.
    if (err instanceof InputError && /áudio/i.test(err.message)) {
      await patchAnalysis(id, { noSpeech: err.message });
      return { transcript: null, noSpeech: err.message, cached: false };
    }
    throw err;
  }
  await patchAnalysis(id, { transcript });
  return { transcript, cached: false };
}

// ---------- Quadros ----------

export const FRAME_SIZES = { small: 512, medium: 640, large: 1024 } as const;

// Um quadro do vídeo em JPEG na pasta de mídia (nome determinístico: o mesmo pedido reaproveita o arquivo).
export async function frameAt(g: Generation & { file: string }, t: number, maxSide: number): Promise<string> {
  const name = `frame-${g.id}-${Math.round(t * 1000)}-${maxSide}.jpg`;
  const out = path.join(MEDIA_DIR, name);
  if (!(await exists(out))) {
    await run(FFMPEG, [
      "-y", "-loglevel", "error", "-ss", t.toFixed(3), "-i", path.join(MEDIA_DIR, g.file), "-frames:v", "1",
      "-vf", `scale=w=${maxSide}:h=${maxSide}:force_original_aspect_ratio=decrease:force_divisible_by=2`, "-q:v", "4", out,
    ]);
    if (!(await exists(out))) throw new Error(`Não consegui extrair o quadro em ${t.toFixed(1)}s.`);
  }
  return name;
}

export type FramePick = { t: number; why: "abertura" | "gancho" | "corte" | "trecho" };

// Escolhe os momentos: abertura e primeiros 3s (gancho), um quadro por corte de cena e o resto espalhado.
export function pickTimes(duration: number, cuts: number[], max: number, start?: number, end?: number): FramePick[] {
  const s = Math.max(0, start ?? 0);
  const e = Math.max(s, Math.min(duration, end ?? duration) - 0.05);
  const span = Math.max(0.1, e - s);
  const gap = Math.max(0.4, span / (max * 2));
  const picked: FramePick[] = [];
  const add = (t: number, why: FramePick["why"], minGap = gap) => {
    const c = Math.min(Math.max(t, s), e);
    if (picked.length < max && picked.every((p) => Math.abs(p.t - c) >= minGap)) picked.push({ t: Math.round(c * 100) / 100, why });
  };
  if (start === undefined && end === undefined) {
    for (const t of [0, 1, 2, 3]) if (t < duration) add(t, t === 0 ? "abertura" : "gancho", 0.4);
  }
  const inRange = cuts.filter((c) => c > s && c < e);
  const room = Math.max(1, max - picked.length);
  const step = inRange.length > room ? inRange.length / room : 1;
  for (let i = 0; i < inRange.length && picked.length < max; i += step) add(inRange[Math.floor(i)] + 0.15, "corte");
  // O resto vai para o ponto menos coberto (o mais longe dos quadros já escolhidos), até o fim do vídeo.
  const grid = Array.from({ length: max * 4 }, (_, i) => s + (span * (i + 0.5)) / (max * 4));
  while (picked.length < max) {
    let best = -1;
    let bestDist = 0;
    for (const t of grid) {
      const dist = Math.min(Infinity, ...picked.map((p) => Math.abs(p.t - t)));
      if (dist > bestDist) [best, bestDist] = [t, dist];
    }
    if (best < 0 || bestDist < gap) break;
    picked.push({ t: Math.round(best * 100) / 100, why: "trecho" });
  }
  return picked.sort((a, b) => a.t - b.t);
}

// ---------- Folha de contato ----------

const TILE = { w: 270, h: 480 };
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

// Várias mídias numa imagem só, numeradas: comparar 16 clipes custa como ver 1 imagem.
export async function contactSheet(tiles: { file: string; label: string }[]): Promise<string> {
  const key = createHash("sha1").update(JSON.stringify(tiles)).digest("hex").slice(0, 16);
  const name = `sheet-${key}.jpg`;
  const out = path.join(MEDIA_DIR, name);
  if (await exists(out)) return name;
  const cols = Math.min(4, tiles.length);
  const rows = Math.ceil(tiles.length / cols);
  const composites = await Promise.all(
    tiles.map(async (tile, i) => {
      const img = await sharp(path.join(MEDIA_DIR, tile.file))
        .rotate()
        .resize({ width: TILE.w, height: TILE.h, fit: "contain", background: "#111111" })
        .composite([
          {
            input: Buffer.from(
              `<svg width="${TILE.w}" height="34"><rect width="${TILE.w}" height="34" fill="#000" fill-opacity="0.75"/><text x="8" y="23" font-family="Arial" font-size="17" font-weight="bold" fill="#fff">${esc(tile.label)}</text></svg>`,
            ),
            top: 0,
            left: 0,
          },
        ])
        .png()
        .toBuffer();
      return { input: img, top: Math.floor(i / cols) * (TILE.h + 6), left: (i % cols) * (TILE.w + 6) };
    }),
  );
  await sharp({ create: { width: cols * (TILE.w + 6) - 6, height: rows * (TILE.h + 6) - 6, channels: 3, background: "#222222" } })
    .composite(composites)
    .jpeg({ quality: 82 })
    .toFile(out);
  return name;
}

// Quadro representativo de uma geração (meio do vídeo, ou a própria imagem).
export async function thumbOf(g: Generation & { file: string }): Promise<string> {
  if (g.kind === "image") return g.file;
  const { meta } = await videoInfo(g);
  return frameAt(g, Math.max(0, meta.duration * 0.5), 480);
}

// ---------- Mídia de um projeto do FLORA ----------

const baseUrl = (u: string) => u.split("?")[0];

// Traz para o hub (como geração "flora") as mídias do canvas que ainda não estão aqui. Só baixa: não cobra nada no FLORA.
export async function importFloraMedia(projectId: string, projectName: string, kind: "video" | "image", limit: number) {
  const nodes = (await listProjectMedia(projectId)).filter((n) => n.type === kind);
  const known = (await listGenerations("flora")).filter((g) => g.status === "done" && g.file);
  const byUrl = new Map(known.filter((g) => g.remoteUrl).map((g) => [baseUrl(g.remoteUrl!), g]));
  const byAsset = new Map(known.filter((g) => typeof g.params.assetId === "string").map((g) => [g.params.assetId as string, g]));
  const items: { generation: Generation; imported: boolean }[] = [];
  for (const n of nodes.slice(0, limit)) {
    const existing = (n.assetId && byAsset.get(n.assetId)) || byUrl.get(baseUrl(n.url));
    if (existing) {
      items.push({ generation: existing, imported: false });
      continue;
    }
    const file = await downloadMedia(n.url, kind === "video" ? "mp4" : "png");
    const generation = await createGeneration({
      tool: "flora",
      kind,
      status: "done",
      prompt: `Importado do projeto "${projectName}" do FLORA`,
      file,
      remoteUrl: n.url,
      params: { modelName: "FLORA (importado)", floraProjectId: projectId, nodeId: n.nodeId, assetId: n.assetId, imported: true },
    });
    items.push({ generation, imported: true });
  }
  return { total: nodes.length, items };
}
