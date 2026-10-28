import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { arquivoLocal, exigirDriveParaVideo } from "@/features/drive/servicos/videos";
import { entrada } from "@/features/edicoes/contrato";
import { iniciarEdicao } from "@/features/edicoes/servicos/rodar";
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
import { pastaDeDados } from "@/lib/server/pastas";
import { palavrasDaFala } from "@/lib/server/video";
import { createGeneration, getGeneration, listGenerations } from "@/lib/server/store";

// Projetos do editor em editor/<id>.json, na pasta da organização (lib/server/pastas.ts). A exportação (ffmpeg e a
// legenda pelo Remotion) roda no servidor de edições ou, sem ele, no site (features/edicoes/servicos/executar.ts).

const pastaDosProjetos = async () => path.join(await pastaDeDados(), "editor");
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

  // Cada vídeo da timeline vai junto com o trabalho (vídeo que está só no Google Drive é baixado na hora de rodar).
  const arquivos: Record<string, string> = {};
  const fontes: Record<string, string> = {};
  for (const sourceId of new Set(clips.map((c) => c.sourceId))) {
    const arquivo = path.basename(project.sources[sourceId].url);
    const nome = `fonte${Object.keys(arquivos).length}${path.extname(arquivo).toLowerCase() || ".mp4"}`;
    arquivos[nome] = arquivo;
    fontes[sourceId] = entrada(nome);
  }
  // Roda em segundo plano (servidor de edições ou o próprio site); a tela acompanha pela geração (running → done/failed).
  await iniciarEdicao({
    id: generation.id,
    rotulo: "",
    outName: `${randomUUID()}.mp4`,
    trabalho: { tipo: "editor", dados: { projeto: project, fontes } },
    arquivos,
  });
  return generation;
}

// Vídeos do hub que podem entrar no editor: só os que estão no Google Drive (regra do dono).
export async function libraryVideos() {
  return (await listGenerations()).filter((g) => g.kind === "video" && g.status === "done" && g.file && g.drive);
}
