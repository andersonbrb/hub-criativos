import "server-only";

import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { applyGraphics, sanitizeGraphics, type GraphicRequest } from "@/lib/server/motion";
import { MEDIA_DIR } from "@/lib/server/media";
import { createGeneration, DATA_DIR, getGeneration, updateGeneration } from "@/lib/server/store";

// Montagem automática do infoproduto (hub/playbooks/infoproduto-edicao-video.md), rodando nesta máquina:
// Python + faster-whisper + ffmpeg (scripts/montagem.py). Não gasta créditos de nenhuma ferramenta.

const SCRIPT = path.join(process.cwd(), "scripts", "montagem.py");
const BEAT_SCRIPT = path.join(process.cwd(), "scripts", "batida.py");
const CAPTION_SCRIPT = path.join(process.cwd(), "scripts", "remover_legenda.py");
const LAMA_MODEL = path.join(DATA_DIR, "models", "big-lama.pt");
const FONTS = path.join(process.cwd(), "scripts", "fonts");
const LOG_DIR = path.join(DATA_DIR, "montagem");
export const LANGS = ["es", "pt", "fr", "en"] as const;

export const logPath = (id: string) => path.join(LOG_DIR, `${id}.log`);

// Montagens rodando neste processo do servidor (sobrevive ao hot reload do dev).
const running: Set<string> = ((globalThis as { __montagens?: Set<string> }).__montagens ??= new Set());

// avatarIds: vários vídeos do avatar, juntados na ordem antes dos cortes (gancho + body, várias tomadas).
// avatarId continua valendo (um só), para o chat e chamadas antigas.
// brollCues: "deixa" de cada b-roll (mesma ordem de brollIds): palavra/frase falada em que ele entra. Vazia = grade do padrão.
// fx: efeitos (scripts/montagem.py, FX_DEFAULTS). Padrão: aproximação lenta nos cortes e b-roll em corte seco, áudio
// sempre tratado; o resto desligado. musicId = áudio do hub para fundo.
// graphics: gráficos animados com Remotion (lib/server/motion.ts), aplicados depois da edição.
export type MontageFx = {
  legenda?: "padrao" | "destaque";
  cor_destaque?: string;
  zoom_cortes?: boolean;
  transicao?: "corte" | "dissolve" | "zoom" | "slide";
  musicId?: string;
  musica_volume?: number;
  cor?: "nenhuma" | "quente" | "fria" | "vivo";
  barra_progresso?: boolean;
};
export type MontageRequest = {
  avatarId?: string;
  avatarIds?: string[];
  brollIds?: string[];
  brollCues?: string[];
  lang?: string;
  name?: string;
  fx?: MontageFx;
  graphics?: GraphicRequest[];
};

// Só o que é válido e diferente do padrão do script.
async function cleanFx(fx: MontageFx | undefined) {
  if (!fx || typeof fx !== "object") return { fx: {}, labels: [] as string[] };
  const out: Record<string, unknown> = {};
  const labels: string[] = [];
  const set = (key: string, value: unknown, label: string) => {
    out[key] = value;
    labels.push(label);
  };
  if (fx.legenda === "destaque") set("legenda", "destaque", "legenda destaque");
  if (typeof fx.cor_destaque === "string" && /^#[0-9a-f]{6}$/i.test(fx.cor_destaque)) out.cor_destaque = fx.cor_destaque;
  if (fx.zoom_cortes === false) set("zoom_cortes", false, "sem aproximação nos cortes");
  if (fx.transicao === "dissolve" || fx.transicao === "zoom" || fx.transicao === "slide") set("transicao", fx.transicao, `transição ${fx.transicao}`);
  if (fx.cor === "quente" || fx.cor === "fria" || fx.cor === "vivo") set("cor", fx.cor, `cor ${fx.cor}`);
  if (fx.barra_progresso === true) set("barra_progresso", true, "barra de progresso");
  if (fx.musicId) {
    const m = await getGeneration(String(fx.musicId));
    if (!m?.file || m.kind !== "audio") throw new InputError("A música precisa ser um áudio pronto do hub.");
    out.musica = path.join(MEDIA_DIR, m.file);
    out.musica_volume = Math.min(1, Math.max(0.02, Number(fx.musica_volume) || 0.18));
    labels.push("música de fundo");
  }
  return { fx: out, labels };
}

const MAX_AVATARS = 20;
const MAX_BROLLS = 40;

async function videoFile(id: string, label: string) {
  const g = await getGeneration(id);
  if (!g || g.kind !== "video" || g.status !== "done" || !g.file) throw new InputError(`${label} precisa ser um vídeo pronto do hub.`);
  return { g, file: path.join(MEDIA_DIR, g.file) };
}

export async function runMontage(req: MontageRequest): Promise<Generation> {
  const avatarIds = [...new Set((req.avatarIds?.length ? req.avatarIds : [req.avatarId ?? ""]).map(String).filter(Boolean))].slice(0, MAX_AVATARS);
  if (!avatarIds.length) throw new InputError("Escolha pelo menos um vídeo do avatar.");
  const avatars = await Promise.all(avatarIds.map((id, i) => videoFile(id, avatarIds.length > 1 ? `O avatar ${i + 1}` : "O avatar")));
  const avatar = avatars[0];
  const pairs = (req.brollIds ?? [])
    .map((id, i) => ({ id: String(id ?? ""), cue: String(req.brollCues?.[i] ?? "").trim().slice(0, 60) }))
    .filter((p) => p.id)
    .slice(0, MAX_BROLLS);
  const brollIds = pairs.map((p) => p.id);
  const brollCues = pairs.map((p) => p.cue);
  const brolls = await Promise.all(brollIds.map((id, i) => videoFile(id, `O b-roll ${i + 1}`)));
  const lang = LANGS.includes(req.lang as (typeof LANGS)[number]) ? (req.lang as string) : "es";
  const name = (String(req.name ?? "").trim() || "AD").replace(/[^\w-]+/g, "_").slice(0, 40);
  const { fx, labels } = await cleanFx(req.fx);
  const graphics = sanitizeGraphics(req.graphics);

  const gen = await createGeneration({
    tool: "montagem",
    kind: "video",
    status: "running",
    prompt: `Edição ${name}: ${avatar.g.prompt}${avatars.length > 1 ? ` (+${avatars.length - 1})` : ""}`,
    params: {
      name,
      lang,
      avatarId: avatar.g.id,
      avatarIds: avatarIds.join(","),
      avatars: avatars.length,
      brolls: brolls.length,
      brollIds: brollIds.join(","),
      brollCues: brollCues.join(" | "),
      efeitos: labels.join(", ") || null,
      graficos: graphics.length ? graphics.map((g) => g.tipo).join(", ") : null,
    },
  });

  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(MEDIA_DIR, { recursive: true });
  const outName = `${randomUUID()}.mp4`;
  const jobFile = path.join(LOG_DIR, `${gen.id}.json`);
  const timelineFile = path.join(LOG_DIR, `${gen.id}.timeline.json`);
  await writeFile(
    jobFile,
    JSON.stringify({
      name,
      avatar: avatar.file,
      avatars: avatars.map((a) => a.file),
      brolls: brolls.map((b) => b.file),
      broll_cues: brollCues,
      lang,
      fx,
      out: path.join(MEDIA_DIR, outName),
      workdir: path.join(DATA_DIR, "tmp", gen.id),
      fontsdir: FONTS,
      timeline_out: timelineFile,
    }),
  );

  launch(gen.id, SCRIPT, jobFile, outName, "Montagem", async (line) => {
    // Gráficos animados (opcionais) depois da edição; se falharem, o vídeo sai sem eles e o log explica.
    if (!graphics.length) return;
    try {
      await applyGraphics({ video: path.join(MEDIA_DIR, outName), timelineFile, graphics, workdir: path.join(DATA_DIR, "tmp", `${gen.id}-gfx`), log: line });
    } catch (err) {
      line(`gráficos animados falharam (${err instanceof Error ? err.message.slice(0, 200) : "erro"}); vídeo entregue sem eles`);
    }
  });

  return gen;
}

// Roda um script Python da edição em segundo plano: o log fica em .data/montagem/<id>.log e o status da geração é
// atualizado ao terminar. `after` roda depois de um DONE (ex.: gráficos animados), antes de marcar como pronta.
function launch(id: string, script: string, jobFile: string, outName: string, label: string, after?: (line: (m: string) => void) => Promise<void>) {
  const log: string[] = [];
  const python = process.env.PYTHON_BIN || "python";
  const child = spawn(python, ["-W", "ignore", script, jobFile], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  child.stdin.end();
  running.add(id);
  const collect = (chunk: Buffer) => {
    log.push(chunk.toString("utf8"));
    writeFile(logPath(id), log.join("")).catch(() => {});
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("error", (err) => {
    running.delete(id);
    updateGeneration(id, { status: "failed", error: `Não consegui rodar o Python (${err.message}). Defina PYTHON_BIN no .env.local.` });
  });
  child.on("close", async (code) => {
    const text = log.join("");
    if (code === 0 && text.includes("DONE")) {
      if (after) await after((m: string) => collect(Buffer.from(`[${new Date().toLocaleTimeString("pt-BR")}] ${m}\n`)));
      running.delete(id);
      await updateGeneration(id, { status: "done", file: outName });
    } else {
      running.delete(id);
      const missing = /No module named '(torch|cv2)'/.exec(text)?.[1];
      const err = missing
        ? `falta instalar ${missing === "cv2" ? "o OpenCV" : "o PyTorch"} neste servidor (pip install torch opencv-python-headless); por enquanto isso roda no PC`
        : (text.match(/ERROR (.+)/)?.[1] ?? text.trim().split("\n").slice(-2).join(" "));
      await updateGeneration(id, { status: "failed", error: `${label}: ${err.slice(0, 300) || `saiu com código ${code}`}` });
    }
  });
}

// ---------- Edição na batida (scripts/batida.py) ----------
// Vídeo curto guiado pela música: uma cena por batida, palavras gigantes, efeitos de movimento, tudo em tela cheia.
// clipIds: vídeos (ou imagens) do hub usados como cenas. songId: áudio do hub; sem ele, uma batida própria sintetizada.
// words: frases curtas em ordem (topo, baixo em cor, índice opcional do clipe que combina). cta: chamada final.
export type BeatRequest = {
  clipIds: string[];
  songId?: string;
  songStart?: number;
  duration?: number;
  bpm?: number;
  words?: { top?: string; bottom?: string; clip?: number }[];
  cta?: { top?: string; bottom?: string; clip?: number };
  accent?: string;
  name?: string;
};

const MAX_BEAT_CLIPS = 16;

export async function runBeatEdit(req: BeatRequest): Promise<Generation> {
  const ids = [...new Set((req.clipIds ?? []).map(String).filter(Boolean))].slice(0, MAX_BEAT_CLIPS);
  if (!ids.length) throw new InputError("Escolha pelo menos um vídeo de cena.");
  const clips = await Promise.all(ids.map((id, i) => videoFile(id, `A cena ${i + 1}`)));
  let song: string | null = null;
  if (req.songId) {
    const m = await getGeneration(String(req.songId));
    if (!m?.file || m.kind !== "audio") throw new InputError("A música precisa ser um áudio pronto do hub.");
    song = path.join(MEDIA_DIR, m.file);
  }
  const cut = (s: unknown, n = 18) => String(s ?? "").replace(/[{}\\]/g, "").trim().slice(0, n);
  const clipIdx = (c: unknown) => (Number.isInteger(c) && (c as number) >= 0 && (c as number) < clips.length ? (c as number) : null);
  const words = (req.words ?? [])
    .map((w) => [cut(w?.top), cut(w?.bottom), clipIdx(w?.clip)] as const)
    .filter(([a, b]) => a || b)
    .slice(0, 40);
  const cta = [cut(req.cta?.top, 24), cut(req.cta?.bottom, 24)];
  const duration = Math.min(60, Math.max(6, Number(req.duration) || 15));
  const bpm = Math.min(180, Math.max(80, Math.round(Number(req.bpm) || 140)));
  const accent = typeof req.accent === "string" && /^#[0-9a-f]{6}$/i.test(req.accent) ? req.accent : "#FFB627";
  const name = (String(req.name ?? "").trim() || "BATIDA").replace(/[^\w-]+/g, "_").slice(0, 40);

  const gen = await createGeneration({
    tool: "montagem",
    kind: "video",
    status: "running",
    prompt: `Edição na batida ${name}: ${words.map(([a, b]) => [a, b].filter(Boolean).join(" ")).join(" / ") || clips[0].g.prompt}`.slice(0, 600),
    params: {
      name,
      formato: "batida",
      cenas: clips.length,
      clipIds: ids.join(","),
      musica: song ? String(req.songId) : "batida própria",
      duracao: duration,
      palavras: words.length,
    },
  });

  await mkdir(LOG_DIR, { recursive: true });
  await mkdir(MEDIA_DIR, { recursive: true });
  const outName = `${randomUUID()}.mp4`;
  const jobFile = path.join(LOG_DIR, `${gen.id}.json`);
  await writeFile(
    jobFile,
    JSON.stringify({
      name,
      clips: clips.map((c) => c.file),
      song,
      song_start: Math.max(0, Number(req.songStart) || 0),
      dur: duration,
      bpm,
      words,
      cta,
      cta_clip: clipIdx(req.cta?.clip),
      accent,
      out: path.join(MEDIA_DIR, outName),
      workdir: path.join(DATA_DIR, "tmp", gen.id),
      fontsdir: FONTS,
    }),
  );
  launch(gen.id, BEAT_SCRIPT, jobFile, outName, "Edição na batida");
  return gen;
}

// ---------- Remover legenda (scripts/remover_legenda.py, LaMa) ----------
// Tira a legenda queimada de um vídeo: acha o texto em cada quadro e preenche a área com o LaMa (inpainting).
// region: onde procurar (baixo, meio, topo, tudo). mode: "auto" (só as letras) ou "faixa" (a faixa inteira do texto).
export const CAPTION_REGIONS = ["baixo", "meio", "topo", "tudo"] as const;
export type CaptionRemovalRequest = { videoId: string; region?: (typeof CAPTION_REGIONS)[number]; mode?: "auto" | "faixa"; name?: string };

// Duração do vídeo (para a previsão de tempo da barra de progresso); 0 se o ffprobe falhar.
function seconds(file: string): Promise<number> {
  return new Promise((resolve) => {
    execFile("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { windowsHide: true }, (err, out) =>
      resolve(err ? 0 : Number(String(out).trim()) || 0),
    );
  });
}

export async function runRemoveCaptions(req: CaptionRemovalRequest): Promise<Generation> {
  const { g, file } = await videoFile(String(req.videoId ?? ""), "O vídeo");
  const region = CAPTION_REGIONS.includes(req.region as (typeof CAPTION_REGIONS)[number]) ? (req.region as string) : "baixo";
  const mode = req.mode === "faixa" ? "faixa" : "auto";
  const name = String(req.name ?? "").trim().slice(0, 80) || `${g.name || g.prompt.slice(0, 50)} · sem legenda`;
  const gen = await createGeneration({
    tool: "montagem",
    kind: "video",
    status: "running",
    name,
    prompt: `Sem legenda: ${g.prompt}`.slice(0, 600),
    params: { formato: "sem-legenda", origem: g.id, regiao: region, modo: mode, duracao: Math.round((await seconds(file)) || Number(g.params.duration) || 0) || null },
  });
  await mkdir(LOG_DIR, { recursive: true });
  const outName = `${randomUUID()}.mp4`;
  const jobFile = path.join(LOG_DIR, `${gen.id}.json`);
  await writeFile(
    jobFile,
    JSON.stringify({ input: file, out: path.join(MEDIA_DIR, outName), workdir: path.join(DATA_DIR, "tmp", gen.id), model: LAMA_MODEL, region, mode }),
  );
  launch(gen.id, CAPTION_SCRIPT, jobFile, outName, "Remover legenda");
  return gen;
}

export async function readLog(id: string): Promise<string> {
  return readFile(logPath(id), "utf8").catch(() => "");
}

// Status atual; se o servidor reiniciou no meio, a montagem morreu junto e é marcada como interrompida.
export async function montageStatus(gen: Generation): Promise<Generation> {
  if (gen.status === "running" && !running.has(gen.id)) {
    return (await updateGeneration(gen.id, { status: "failed", error: "Montagem interrompida (o servidor reiniciou). Rode de novo." })) ?? gen;
  }
  return gen;
}
