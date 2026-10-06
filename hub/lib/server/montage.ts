import "server-only";

import { spawn } from "node:child_process";
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
const FONTS = path.join(process.cwd(), "scripts", "fonts");
const LOG_DIR = path.join(DATA_DIR, "montagem");
export const LANGS = ["es", "pt", "fr", "en"] as const;

export const logPath = (id: string) => path.join(LOG_DIR, `${id}.log`);

// Montagens rodando neste processo do servidor (sobrevive ao hot reload do dev).
const running: Set<string> = ((globalThis as { __montagens?: Set<string> }).__montagens ??= new Set());

// avatarIds: vários vídeos do avatar, juntados na ordem antes dos cortes (gancho + body, várias tomadas).
// avatarId continua valendo (um só), para o chat e chamadas antigas.
// brollCues: "deixa" de cada b-roll (mesma ordem de brollIds): palavra/frase falada em que ele entra. Vazia = grade do padrão.
// fx: efeitos opcionais (scripts/montagem.py, FX_DEFAULTS), todos desligados por padrão. musicId = áudio do hub para fundo.
// graphics: gráficos animados com Remotion (lib/server/motion.ts), aplicados depois da edição.
export type MontageFx = {
  legenda?: "padrao" | "destaque";
  cor_destaque?: string;
  zoom_cortes?: boolean;
  transicao?: "dissolve" | "zoom" | "slide";
  sons?: boolean;
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

// Só o que é válido; o resto fica no padrão do script (desligado).
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
  if (fx.zoom_cortes === true) set("zoom_cortes", true, "zoom nos cortes");
  if (fx.transicao === "zoom" || fx.transicao === "slide") set("transicao", fx.transicao, `transição ${fx.transicao}`);
  if (fx.sons === true) set("sons", true, "whoosh");
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

  // Roda em segundo plano; o log fica em .data/montagem/<id>.log e o status é atualizado ao terminar.
  const log: string[] = [];
  const python = process.env.PYTHON_BIN || "python";
  const child = spawn(python, ["-W", "ignore", SCRIPT, jobFile], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  child.stdin.end();
  running.add(gen.id);
  const collect = (chunk: Buffer) => {
    log.push(chunk.toString("utf8"));
    writeFile(logPath(gen.id), log.join("")).catch(() => {});
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.on("error", (err) => {
    running.delete(gen.id);
    updateGeneration(gen.id, { status: "failed", error: `Não consegui rodar o Python (${err.message}). Defina PYTHON_BIN no .env.local.` });
  });
  child.on("close", async (code) => {
    const text = log.join("");
    if (code === 0 && text.includes("DONE")) {
      // Gráficos animados (opcionais) depois da edição; se falharem, o vídeo sai sem eles e o log explica.
      if (graphics.length) {
        const line = (m: string) => collect(Buffer.from(`[${new Date().toLocaleTimeString("pt-BR")}] ${m}\n`));
        try {
          await applyGraphics({ video: path.join(MEDIA_DIR, outName), timelineFile, graphics, workdir: path.join(DATA_DIR, "tmp", `${gen.id}-gfx`), log: line });
        } catch (err) {
          line(`gráficos animados falharam (${err instanceof Error ? err.message.slice(0, 200) : "erro"}); vídeo entregue sem eles`);
        }
      }
      running.delete(gen.id);
      await updateGeneration(gen.id, { status: "done", file: outName });
    } else {
      running.delete(gen.id);
      const err = text.match(/ERROR (.+)/)?.[1] ?? text.trim().split("\n").slice(-2).join(" ");
      await updateGeneration(gen.id, { status: "failed", error: `Montagem: ${err.slice(0, 300) || `saiu com código ${code}`}` });
    }
  });

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
