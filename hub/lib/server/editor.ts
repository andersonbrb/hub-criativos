import "server-only";

import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { segurarTemp, soltarTemp } from "@/features/drive/servicos/arquivos";
import { apagarDaMidia, arquivoLocal, concluirComArquivo, exigirDriveParaVideo } from "@/features/drive/servicos/videos";
import {
  DEFAULT_STYLE,
  newId,
  placeCaptions,
  placeClips,
  wordsToCaptions,
  type CaptionStyle,
  type EditorProject,
  type EditorProjectSummary,
  type EditorSource,
} from "@/lib/editor";
import type { Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { aplicarCamada, type CamadaDoVideo } from "@/lib/server/motion";
import { pastaDeDados, pastaDeMidia } from "@/lib/server/pastas";
import { palavrasDaFala } from "@/lib/server/video";
import { createGeneration, getGeneration, listGenerations, updateGeneration } from "@/lib/server/store";
import type { Legenda, Palavra } from "@/remotion/Camada";

// Projetos do editor em editor/<id>.json, na pasta da organização (lib/server/pastas.ts); exportação com ffmpeg
// (precisa estar instalado, ou FFMPEG_BIN).

const pastaDosProjetos = async () => path.join(await pastaDeDados(), "editor");
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";

const file = async (id: string) => path.join(await pastaDosProjetos(), `${id}.json`);
const validId = (id: string) => /^[\w-]+$/.test(id);

function run(bin: string, args: string[], opts: { cwd?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(bin, args, { cwd: opts.cwd, timeout: opts.timeout ?? 120_000, maxBuffer: 50 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return reject(new Error(`${bin} não encontrado. Instale o ffmpeg ou defina FFMPEG_BIN/FFPROBE_BIN no .env.local.`));
        return reject(new Error(`${path.basename(bin)}: ${(stderr || err.message).trim().split("\n").slice(-3).join(" ")}`));
      }
      resolve(stdout);
    });
    child.stdin?.end();
  });
}

// ---------- Projetos ----------

export async function getProject(id: string): Promise<EditorProject | null> {
  if (!validId(id)) return null;
  try {
    return JSON.parse(await readFile(await file(id), "utf8")) as EditorProject;
  } catch {
    return null;
  }
}

async function write(project: EditorProject) {
  await mkdir(await pastaDosProjetos(), { recursive: true });
  project.updatedAt = new Date().toISOString();
  const destino = await file(project.id);
  const tmp = `${destino}.tmp`;
  await writeFile(tmp, JSON.stringify(project, null, 1));
  await rename(tmp, destino);
  return project;
}

export async function listProjects(): Promise<EditorProjectSummary[]> {
  const names = (await readdir(await pastaDosProjetos()).catch(() => [] as string[])).filter((n) => n.endsWith(".json"));
  const projects = (await Promise.all(names.map((n) => getProject(n.slice(0, -5))))).filter((p): p is EditorProject => Boolean(p));
  return projects
    .map((p) => ({ id: p.id, title: p.title, originId: p.originId, updatedAt: p.updatedAt, clips: p.clips.length }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string) {
  if (validId(id)) await unlink(await file(id)).catch(() => undefined);
}

async function probe(gen: Generation): Promise<EditorSource> {
  if (gen.kind !== "video" || !gen.file) throw new InputError("Escolha um vídeo pronto do hub.");
  const out = JSON.parse(
    await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", await arquivoLocal(gen.file)]),
  ) as { streams: { codec_type: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[]; format: { duration?: string } };
  const video = out.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new InputError("Não consegui ler as dimensões do vídeo.");
  const rotation = Math.abs(Number(video.tags?.rotate ?? video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  const [width, height] = rotation === 90 || rotation === 270 ? [video.height, video.width] : [video.width, video.height];
  return {
    id: gen.id,
    label: gen.prompt.slice(0, 80) || "Vídeo",
    url: `/api/media/${gen.file}`,
    duration: Number(out.format.duration) || 0,
    width,
    height,
    hasAudio: out.streams.some((s) => s.codec_type === "audio"),
  };
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// Abre um vídeo no editor: export do editor volta para o projeto dele; um vídeo já aberto antes reaproveita o projeto.
export async function openProject(generationId: string): Promise<EditorProject> {
  const gen = await getGeneration(generationId);
  if (!gen) throw new InputError("Vídeo não encontrado.");
  if (gen.tool === "editor" && typeof gen.params.projectId === "string") {
    const existing = await getProject(gen.params.projectId);
    if (existing) return existing;
  }
  for (const summary of await listProjects()) {
    if (summary.originId === generationId) return (await getProject(summary.id))!;
  }
  const source = await probe(gen);
  // Saída limitada a 1080 px no lado menor, mantendo a proporção do vídeo.
  const scale = Math.min(1, 1080 / Math.min(source.width, source.height));
  const now = new Date().toISOString();
  return write({
    id: randomUUID(),
    title: source.label.slice(0, 60),
    originId: gen.id,
    width: even(source.width * scale),
    height: even(source.height * scale),
    fps: 30,
    sources: { [source.id]: source },
    clips: [{ id: newId(), sourceId: source.id, in: 0, out: source.duration }],
    captions: [],
    captionsEnabled: true,
    style: DEFAULT_STYLE,
    exports: [],
    createdAt: now,
    updatedAt: now,
  });
}

// Junta vários vídeos do hub, na ordem, num projeto novo do editor (ex.: gancho + body). Cada trecho pode ter corte (in/out em segundos).
// O tamanho da saída vem do primeiro vídeo; os outros entram com barras pretas se a proporção for diferente.
export async function joinProject(items: { generationId: string; in?: number; out?: number }[], title?: string): Promise<EditorProject> {
  if (items.length < 2) throw new InputError("Informe pelo menos 2 vídeos para juntar.");
  const sources: Record<string, EditorSource> = {};
  const clips: EditorProject["clips"] = [];
  for (const item of items) {
    const gen = await getGeneration(item.generationId);
    if (!gen) throw new InputError(`Vídeo não encontrado: ${item.generationId}.`);
    const source = sources[gen.id] ?? (await probe(gen));
    sources[source.id] = source;
    const start = clampNum(item.in, 0, source.duration, 0);
    const end = clampNum(item.out, start + 0.05, source.duration, source.duration);
    clips.push({ id: newId(), sourceId: source.id, in: start, out: end });
  }
  const first = sources[clips[0].sourceId];
  const scale = Math.min(1, 1080 / Math.min(first.width, first.height));
  const now = new Date().toISOString();
  return write({
    id: randomUUID(),
    title: (title?.trim() || Object.values(sources).map((s) => s.label.slice(0, 25)).join(" + ")).slice(0, 60),
    // Sem origem: abrir um dos vídeos sozinho no editor não deve cair neste projeto.
    originId: "",
    width: even(first.width * scale),
    height: even(first.height * scale),
    fps: 30,
    sources,
    clips,
    captions: [],
    captionsEnabled: true,
    style: DEFAULT_STYLE,
    exports: [],
    createdAt: now,
    updatedAt: now,
  });
}

export async function addSource(projectId: string, generationId: string): Promise<EditorProject> {
  const project = await getProject(projectId);
  if (!project) throw new InputError("Projeto não encontrado.");
  const gen = await getGeneration(generationId);
  if (!gen) throw new InputError("Vídeo não encontrado.");
  const source = project.sources[gen.id] ?? (await probe(gen));
  project.sources[source.id] = source;
  project.clips.push({ id: newId(), sourceId: source.id, in: 0, out: source.duration });
  return write(project);
}

const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

// Salva o que a tela editou. Fontes de mídia e exportações não vêm do cliente.
export async function saveProject(id: string, input: Partial<EditorProject>): Promise<EditorProject> {
  const project = await getProject(id);
  if (!project) throw new InputError("Projeto não encontrado.");
  if (typeof input.title === "string") project.title = input.title.slice(0, 120);
  if (Array.isArray(input.clips)) {
    project.clips = input.clips
      .filter((c) => project.sources[c.sourceId])
      .map((c) => {
        const max = project.sources[c.sourceId].duration;
        const start = clampNum(c.in, 0, max, 0);
        return { id: String(c.id || newId()), sourceId: c.sourceId, in: start, out: clampNum(c.out, start + 0.05, max, max) };
      });
  }
  if (Array.isArray(input.captions)) {
    project.captions = input.captions
      .filter((c) => project.sources[c.sourceId])
      .map((c) => {
        const start = Math.max(0, Number(c.start) || 0);
        return { id: String(c.id || newId()), sourceId: c.sourceId, start, end: Math.max(start + 0.05, Number(c.end) || start + 1), text: String(c.text ?? "").slice(0, 300) };
      });
  }
  if (typeof input.captionsEnabled === "boolean") project.captionsEnabled = input.captionsEnabled;
  if (input.style) project.style = { ...DEFAULT_STYLE, ...project.style, ...input.style } as CaptionStyle;
  return write(project);
}

// ---------- Legendas automáticas ----------

export async function autoCaptions(projectId: string, opts: { sourceId?: string; perCaption?: number } = {}): Promise<EditorProject> {
  const project = await getProject(projectId);
  if (!project) throw new InputError("Projeto não encontrado.");
  const perCaption = clampNum(opts.perCaption, 1, 8, 3);
  const ids = opts.sourceId ? [opts.sourceId] : [...new Set(project.clips.map((c) => c.sourceId))];
  for (const sourceId of ids) {
    const source = project.sources[sourceId];
    if (!source?.hasAudio) continue;
    // Fala do vídeo de origem (a legenda guarda o tempo da origem): transcrição salva ou Whisper local, um por vez
    // (contexto do Sávio). Para o texto do roteiro, quem chama troca o texto das legendas depois (editor_open captions).
    const words = await palavrasDaFala(sourceId);
    project.captions = [...project.captions.filter((c) => c.sourceId !== sourceId), ...wordsToCaptions(words, sourceId, perCaption)];
  }
  if (!project.captions.length) throw new InputError("Não encontrei fala nesse vídeo para legendar.");
  return write(project);
}

// ---------- Exportação ----------

// Cor #RRGGBB → &HAABBGGRR do ASS (alpha 00 = opaco).
const assColor = (hex: string, alpha = "00") => {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "FFFFFF";
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
};

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

export function buildAss(project: EditorProject): string {
  const { width: W, height: H, style } = project;
  const scale = Math.min(W, H) / 1080;
  const size = Math.round(style.size * scale);
  const outline = Math.round(style.outline * scale);
  const margin = Math.round(W * 0.08);
  const base = assColor(style.color);
  const hl = assColor(style.highlight);
  const boxColor = assColor("#000000", "40");
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.font},${size},${base},${base},${style.box ? boxColor : "&H00000000"},${style.box ? boxColor : "&H80000000"},-1,0,0,0,100,100,0,0,${style.box ? 3 : 1},${style.box ? Math.max(outline, Math.round(14 * scale)) : outline},0,5,${margin},${margin},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const pos = `{\\an5\\pos(${Math.round(W / 2)},${Math.round((H * style.position) / 100)})${style.pop ? "\\fscx82\\fscy82\\t(0,140,\\fscx100\\fscy100)" : ""}}`;
  const events = placeCaptions(project).map((c) => {
    // Do jeito que foi falada, nunca toda em caixa alta (decisão do Vinícius, 20/10/2026): `uppercase` de projeto antigo é ignorado.
    const raw = c.text;
    const text = raw
      .replace(/[{}\\]/g, "")
      .replace(/\n/g, "\\N")
      .replace(/\*([^*]+)\*/g, `{\\c${hl}}$1{\\c${base}}`);
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${pos}${text}`;
  });
  return [...header, ...events, ""].join("\n");
}

// Legenda do editor no formato da camada do Remotion (remotion/Camada.tsx): *palavra* em destaque, \n quebra a linha.
function legendaDoEditor(project: EditorProject): Legenda {
  const { width: W, height: H, style } = project;
  const scale = Math.min(W, H) / 1080;
  const blocos = placeCaptions(project).map((c) => {
    const palavras: Palavra[] = [];
    const linhas = c.text.split("\n");
    linhas.forEach((linha, li) => {
      for (const parte of linha.split(/(\*[^*]+\*)/g).filter(Boolean)) {
        const destaque = parte.startsWith("*") && parte.endsWith("*") && parte.length > 2;
        for (const t of (destaque ? parte.slice(1, -1) : parte).split(/\s+/).filter(Boolean)) palavras.push({ t, s: c.start, ...(destaque ? { destaque } : {}) });
      }
      if (li < linhas.length - 1 && palavras.length) palavras[palavras.length - 1].quebra = true;
    });
    return { ini: c.start, fim: c.end, palavras };
  });
  return {
    fonte: style.font,
    tamanho: style.size * scale,
    peso: 900,
    y: (H * style.position) / 100,
    cor: style.color,
    destaque: style.highlight,
    contorno: style.outline * scale,
    caixa: style.box,
    pop: style.pop ? "suave" : "nenhum",
    modo: "bloco",
    margem: W * 0.08,
    blocos,
  };
}

export async function renderProject(projectId: string): Promise<Generation> {
  // Regra do dono: o vídeo exportado vai só para o Drive. Sem Drive conectado, nem começa.
  await exigirDriveParaVideo();
  const project = await getProject(projectId);
  if (!project) throw new InputError("Projeto não encontrado.");
  const { clips, total } = placeClips(project);
  if (!clips.length || total < 0.1) throw new InputError("A timeline está vazia.");

  const generation = await createGeneration({
    tool: "editor",
    kind: "video",
    status: "running",
    prompt: project.title,
    params: { projectId: project.id, editLabel: "Editor de vídeo", duration: Number(total.toFixed(2)), captions: project.captionsEnabled ? placeCaptions(project).length : 0 },
  });
  project.exports = [generation.id, ...project.exports];
  await write(project);

  // Roda em segundo plano; a tela acompanha pela geração (status running → done/failed).
  void encode(project, generation.id).catch(async (err) => {
    await updateGeneration(generation.id, { status: "failed", error: err instanceof Error ? err.message.slice(0, 400) : "Falha no ffmpeg" });
  });
  return generation;
}

async function encode(project: EditorProject, generationId: string) {
  const { clips } = placeClips(project);
  const { width: W, height: H, fps } = project;
  const tmp = await mkdtemp(path.join(os.tmpdir(), "hub-render-"));
  // Cópias temporárias das fontes, seguras enquanto o ffmpeg trabalha e soltas no fim (saem logo depois).
  const seguras: string[] = [];
  let outName: string | null = null;
  try {
    // Caminho no disco de cada fonte (vídeo que está só no Google Drive vira uma cópia temporária).
    const entradas = new Map<string, string>();
    for (const c of clips) {
      if (entradas.has(c.sourceId)) continue;
      const caminho = await arquivoLocal(path.basename(project.sources[c.sourceId].url));
      segurarTemp(caminho, 6 * 60 * 60 * 1000);
      seguras.push(caminho);
      entradas.set(c.sourceId, caminho);
    }
    const args = ["-y", "-loglevel", "error"];
    const filters: string[] = [];
    const concatInputs: string[] = [];
    let input = 0;
    clips.forEach((c, i) => {
      const src = project.sources[c.sourceId];
      args.push("-ss", c.in.toFixed(3), "-t", c.duration.toFixed(3), "-i", entradas.get(c.sourceId)!);
      const vi = input++;
      filters.push(
        `[${vi}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
      );
      if (src.hasAudio) {
        filters.push(`[${vi}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        args.push("-f", "lavfi", "-t", c.duration.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
        filters.push(`[${input++}:a]asetpts=PTS-STARTPTS[a${i}]`);
      }
      concatInputs.push(`[v${i}][a${i}]`);
    });
    filters.push(`${concatInputs.join("")}concat=n=${clips.length}:v=1:a=1[vc][ac]`);

    // A legenda sai pelo Remotion depois do corte (regra do dono, 27/10/2026), como na prévia do editor.
    const videoOut = "[vc]";
    const comLegenda = project.captionsEnabled && placeCaptions(project).length > 0;

    const midia = await pastaDeMidia();
    await mkdir(midia, { recursive: true });
    outName = `${randomUUID()}.mp4`;
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", videoOut, "-map", "[ac]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", comLegenda ? "16" : "20",
      // Áudio no padrão de entrega do Sávio: AAC 48 kHz estéreo 128k.
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      path.join(midia, outName),
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(FFMPEG, args, { cwd: tmp, windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
      child.on("error", (e) => reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new Error("ffmpeg não encontrado. Instale o ffmpeg ou defina FFMPEG_BIN.") : e));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${stderr.trim().split("\n").slice(-3).join(" ")}`))));
    });
    if (comLegenda) {
      // Se o Remotion falhar, a legenda sai pelo ASS de antes (buildAss).
      const camada: CamadaDoVideo = { duracao: placeClips(project).total, altura: H, largura: W, legenda: legendaDoEditor(project), ass: buildAss(project) };
      await aplicarCamada({ video: path.join(midia, outName), camada, workdir: path.join(tmp, "camada"), log: (m) => console.log(`[editor] ${m}`), crf: 20 });
    }
    // Pronta, a exportação segue para o Google Drive em segundo plano (features/drive). Apagada durante a exportação,
    // o vídeo novo não tem dono e sai na hora.
    const pronto = outName;
    outName = null;
    await concluirComArquivo(generationId, { file: pronto });
  } finally {
    // Deu erro no meio: o vídeo pela metade sai da pasta de mídia.
    if (outName) await apagarDaMidia(outName);
    for (const caminho of seguras) soltarTemp(caminho);
    await rm(tmp, { recursive: true, force: true });
  }
}

// Vídeos do hub que podem entrar no editor: só os que estão no Google Drive (regra do dono).
export async function libraryVideos() {
  return (await listGenerations()).filter((g) => g.kind === "video" && g.status === "done" && g.file && g.drive);
}
