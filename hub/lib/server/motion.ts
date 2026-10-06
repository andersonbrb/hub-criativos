import "server-only";

import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Gráficos animados da edição final (motion graphics), feitos com Remotion (remotion/Graficos.tsx).
// O Remotion desenha os quadros em PNG com fundo transparente e o ffmpeg do sistema sobrepõe ao vídeo editado
// (o ffmpeg embutido do Remotion é bloqueado pelo Controle de Aplicativo do Windows desta máquina).
// Licença do Remotion: grátis para pessoa física e empresas de até 3 pessoas (remotion.pro/license).

export const GRAPHIC_TYPES = ["titulo", "destaque", "lista", "contador", "cta"] as const;
export type GraphicType = (typeof GRAPHIC_TYPES)[number];

// Pedido (tela ou agente): o momento vem de `inicio` (s) ou de `deixa` (palavra falada); sem nenhum, um padrão por tipo.
export type GraphicRequest = {
  tipo: GraphicType;
  texto: string;
  sub?: string;
  itens?: string[];
  deixa?: string;
  inicio?: number;
  duracao?: number;
  cor?: string;
};

type Timeline = { duration: number; words: { w: string; s: number; e: number }[] };

const DURACAO: Record<GraphicType, number> = { titulo: 2.6, destaque: 2.4, lista: 4, contador: 4, cta: 3.5 };
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

function findCue(cue: string, words: Timeline["words"]): number | null {
  const toks = norm(cue).split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  const ws = words.map((w) => norm(w.w));
  for (let i = 0; i < ws.length; i++) {
    if (toks.every((t, k) => ws[i + k]?.startsWith(t))) return words[i].s;
  }
  return null;
}

export function sanitizeGraphics(raw: unknown): GraphicRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => (g && typeof g === "object" ? (g as Record<string, unknown>) : {}))
    .filter((g) => GRAPHIC_TYPES.includes(g.tipo as GraphicType) && (String(g.texto ?? "").trim() || g.tipo === "cta" || g.tipo === "contador" || Array.isArray(g.itens)))
    .slice(0, 12)
    .map((g) => ({
      tipo: g.tipo as GraphicType,
      texto: String(g.texto ?? "").slice(0, 80),
      sub: g.sub ? String(g.sub).slice(0, 60) : undefined,
      itens: Array.isArray(g.itens) ? g.itens.map(String).filter(Boolean).slice(0, 6) : undefined,
      deixa: g.deixa ? String(g.deixa).slice(0, 60) : undefined,
      inicio: g.inicio === undefined || g.inicio === null || g.inicio === "" ? undefined : Number(g.inicio),
      duracao: g.duracao === undefined || g.duracao === null || g.duracao === "" ? undefined : Number(g.duracao),
      cor: typeof g.cor === "string" && /^#[0-9a-f]{6}$/i.test(g.cor) ? g.cor : undefined,
    }));
}

// Resolve o momento de cada gráfico na linha do tempo final (depois dos cortes).
function place(graphics: GraphicRequest[], tl: Timeline, log: (m: string) => void) {
  const D = tl.duration;
  return graphics
    .map((g) => {
      const dur = Math.min(Math.max(0.8, Number.isFinite(g.duracao) ? (g.duracao as number) : DURACAO[g.tipo]), D);
      let start: number | null = Number.isFinite(g.inicio) ? (g.inicio as number) : null;
      if (start === null && g.deixa) {
        const hit = findCue(g.deixa, tl.words);
        if (hit !== null) {
          start = Math.max(0, hit - 0.1);
          log(`gráfico ${g.tipo}: deixa "${g.deixa}" falada em ${hit.toFixed(1)}s`);
        } else log(`gráfico ${g.tipo}: deixa "${g.deixa}" não encontrada; usando o momento padrão`);
      }
      if (start === null) start = g.tipo === "cta" ? D - dur : g.tipo === "titulo" || g.tipo === "contador" ? 0.3 : D / 3;
      start = Math.min(Math.max(0, start), Math.max(0, D - 0.5));
      return { tipo: g.tipo, texto: g.texto, sub: g.sub, itens: g.itens, cor: g.cor, inicio: Number(start.toFixed(2)), duracao: Number(Math.min(dur, D - start).toFixed(2)) };
    })
    .filter((g) => g.duracao >= 0.5);
}

function exec(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, windowsHide: true });
    let err = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => (err = (err + d).slice(-3000)));
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (e) => (clearTimeout(t), reject(e)));
    child.on("close", (code) => (clearTimeout(t), code === 0 ? resolve() : reject(new Error(err.trim().split("\n").slice(-4).join(" ") || `saiu com código ${code}`))));
    child.stdin?.end();
  });
}

// Desenha os gráficos e sobrepõe ao vídeo (substitui o arquivo). Lança erro se falhar; quem chama decide o que fazer.
export async function applyGraphics(opts: { video: string; timelineFile: string; graphics: GraphicRequest[]; workdir: string; log: (m: string) => void }) {
  const tl = JSON.parse(await readFile(opts.timelineFile, "utf8")) as Timeline;
  const elementos = place(opts.graphics, tl, opts.log);
  if (!elementos.length) {
    opts.log("gráficos: nenhum coube no tempo do vídeo");
    return;
  }
  await mkdir(opts.workdir, { recursive: true });
  const seq = path.join(opts.workdir, "graficos");
  const props = path.join(opts.workdir, "graficos.json");
  await writeFile(props, JSON.stringify({ duracao: tl.duration, elementos }));
  opts.log(`gráficos animados: ${elementos.map((e) => `${e.tipo} em ${e.inicio}s`).join(", ")} (renderizando com Remotion)`);

  const root = process.cwd();
  const cli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
  await exec(process.execPath, [cli, "render", "remotion/index.ts", "Graficos", seq, `--props=${props}`, "--sequence", "--image-format=png", "--log=error"], root, 15 * 60_000);

  const frames = (await readdir(seq)).filter((f) => f.endsWith(".png")).sort();
  if (!frames.length) throw new Error("o Remotion não gerou quadros");
  const digits = frames[0].match(/(\d+)\.png$/)?.[1].length ?? 3;
  const tmp = `${opts.video}.gfx.mp4`;
  await exec(
    FFMPEG,
    [
      "-y", "-v", "error",
      "-i", opts.video,
      "-framerate", "30", "-i", path.join(seq, `element-%0${digits}d.png`),
      "-filter_complex", "[0:v][1:v]overlay=0:0:eof_action=pass[v]",
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-r", "30", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "21",
      "-c:a", "copy", "-movflags", "+faststart",
      tmp,
    ],
    root,
    10 * 60_000,
  );
  await rename(tmp, opts.video);
  await rm(opts.workdir, { recursive: true, force: true });
  opts.log("gráficos animados aplicados");
}
