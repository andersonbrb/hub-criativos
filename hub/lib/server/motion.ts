import "server-only";

import { spawn } from "node:child_process";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CamadaProps } from "@/remotion/Camada";

// Camada visual de TODAS as edições de criativo (regra do dono, 27/10/2026: o Remotion é o motor visual principal):
// legenda, palavras da batida, aviso, barra, setas do CTA e gráficos animados (remotion/Camada.tsx).
// O Remotion desenha os quadros em PNG com fundo transparente e o ffmpeg do sistema sobrepõe ao vídeo editado
// (o ffmpeg embutido do Remotion é bloqueado pelo Controle de Aplicativo do Windows desta máquina).
// Se o Remotion falhar, a legenda sai pelo ASS de reserva (o desenho antigo do ffmpeg): nenhum vídeo fica sem legenda.
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
  // topo | meio | baixo (acima da legenda). Padrão: título/contador topo, lista meio, destaque e CTA baixo.
  posicao?: GraphicPosition;
};

export const GRAPHIC_POSITIONS = ["topo", "meio", "baixo"] as const;
export type GraphicPosition = (typeof GRAPHIC_POSITIONS)[number];

type Timeline = { duration: number; words: { w: string; s: number; e: number }[] };

// Fontes da camada (Poppins, Anton, Montserrat): o render roda com --public-dir apontando para cá.
const FONTS = path.join(process.cwd(), "scripts", "fonts");

const DURACAO: Record<GraphicType, number> = { titulo: 2.6, destaque: 2.4, lista: 4, contador: 4, cta: 3.5 };
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();

// Número por extenso → dígitos (pt, es, en, fr), dos dois lados: o Whisper escreve "4" quando a deixa diz "quatro".
// O mesmo mapa existe em scripts/montagem.py (NUM_WORDS).
const NUM_WORDS: Record<string, number> = {};
for (const [n, list] of Object.entries({
  0: "zero cero", 1: "um uma uno una un une one", 2: "dois duas dos two deux", 3: "tres three trois", 4: "quatro cuatro four quatre",
  5: "cinco five cinq", 6: "seis six", 7: "sete siete seven sept", 8: "oito ocho eight huit", 9: "nove nueve nine neuf",
  10: "dez diez ten dix", 11: "onze once eleven", 12: "doze doce twelve douze", 13: "treze trece thirteen treize",
  14: "quatorze catorze fourteen", 15: "quinze quince fifteen", 16: "dezesseis dieciseis sixteen seize",
  17: "dezessete diecisiete seventeen", 18: "dezoito dieciocho eighteen", 19: "dezenove diecinueve nineteen",
  20: "vinte veinte twenty vingt", 30: "trinta treinta thirty trente", 40: "quarenta cuarenta forty quarante",
  50: "cinquenta cincuenta fifty cinquante", 60: "sessenta sesenta sixty soixante", 70: "setenta seventy",
  80: "oitenta ochenta eighty", 90: "noventa ninety", 100: "cem cien hundred cent",
}))
  for (const w of list.split(" ")) NUM_WORDS[w] = Number(n);

type Tok = { t: string; s: number };

// Tokens normalizados com números por extenso em dígitos, juntando dezena + unidade ("quarenta e nove" → "49").
function numTokens(raw: Tok[]): Tok[] {
  const toks = raw.map((x) => (x.t in NUM_WORDS ? { ...x, t: String(NUM_WORDS[x.t]) } : x));
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tens = Number(toks[i].t);
    const isTens = /^\d+$/.test(toks[i].t) && tens >= 20 && tens <= 90 && tens % 10 === 0;
    const j = ["e", "y", "et", "and"].includes(toks[i + 1]?.t ?? "") ? i + 2 : i + 1;
    if (isTens && /^[1-9]$/.test(toks[j]?.t ?? "")) {
      out.push({ t: String(tens + Number(toks[j].t)), s: toks[i].s });
      i = j;
    } else out.push(toks[i]);
  }
  return out;
}

const split = (text: string, s = 0): Tok[] => norm(text).split(/\s+/).filter(Boolean).map((t) => ({ t, s }));

// Palavra da fala bate com o token da deixa: número tem que ser igual; palavra, começar igual.
const tokenHit = (word: string | undefined, tok: string) => word !== undefined && (/^\d+$/.test(tok) ? word === tok : word.startsWith(tok));

function findCue(cue: string, words: Timeline["words"]): number | null {
  const toks = numTokens(split(cue)).map((x) => x.t);
  if (!toks.length) return null;
  const ws = numTokens(words.flatMap((w) => split(w.w, w.s)));
  for (let i = 0; i < ws.length; i++) {
    if (toks.every((t, k) => tokenHit(ws[i + k]?.t, t))) return ws[i].s;
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
      posicao: GRAPHIC_POSITIONS.includes(g.posicao as GraphicPosition) ? (g.posicao as GraphicPosition) : undefined,
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
      return { tipo: g.tipo, texto: g.texto, sub: g.sub, itens: g.itens, cor: g.cor, posicao: g.posicao, inicio: Number(start.toFixed(2)), duracao: Number(Math.min(dur, D - start).toFixed(2)) };
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

// Gráficos pedidos no momento certo da linha do tempo final (palavras depois dos cortes, timeline_out do script).
export async function posicionarGraficos(graphics: GraphicRequest[], timelineFile: string, log: (m: string) => void) {
  if (!graphics.length) return [];
  const tl = JSON.parse(await readFile(timelineFile, "utf8")) as Timeline;
  const elementos = place(graphics, tl, log);
  if (!elementos.length) log("gráficos: nenhum coube no tempo do vídeo");
  return elementos;
}

// Camada com o ASS de reserva (gerado pelo script junto com os dados da camada).
export type CamadaDoVideo = CamadaProps & { ass?: string };

const temDesenho = (c: CamadaProps) => Boolean(c.legenda?.blocos.length || c.slams?.length || c.aviso || c.barra || c.cta || c.elementos?.length);

// Desenha a camada com o Remotion e sobrepõe ao vídeo (substitui o arquivo). limiteMb: teto de bitrate da saída
// (edição na batida, que entrega direto); sem ele, sai um mestre de alta qualidade para a entrega vir depois.
// Se o Remotion falhar, queima o ASS de reserva com o ffmpeg; sem ASS, lança o erro.
export async function aplicarCamada(opts: { video: string; camada: CamadaDoVideo; workdir: string; log: (m: string) => void; limiteMb?: number; crf?: number }) {
  const { ass, ...props } = opts.camada;
  if (!temDesenho(props)) return;
  await mkdir(opts.workdir, { recursive: true });
  const tmp = `${opts.video}.gfx.mp4`;
  const root = process.cwd();
  const saida = await qualidade(opts.video, opts.limiteMb, opts.crf);
  // Os quadros e o vídeo intermediário saem sempre, com sucesso ou com erro (regra do dono: sobra de vídeo não fica).
  try {
    try {
      const seq = path.join(opts.workdir, "camada");
      const arquivoProps = path.join(opts.workdir, "camada.json");
      await writeFile(arquivoProps, JSON.stringify(props));
      const partes = [
        props.legenda?.blocos.length ? `legenda (${props.legenda.blocos.length} blocos)` : "",
        props.slams?.length ? `${props.slams.length} palavras da batida` : "",
        props.aviso ? "aviso" : "",
        props.barra ? "barra" : "",
        props.cta ? "setas do CTA" : "",
        props.elementos?.length ? `gráficos: ${props.elementos.map((e) => `${e.tipo} em ${e.inicio}s`).join(", ")}` : "",
      ].filter(Boolean);
      opts.log(`camada visual no Remotion: ${partes.join(", ")}`);
      const cli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
      await exec(
        process.execPath,
        [cli, "render", "remotion/index.ts", "Camada", seq, `--props=${arquivoProps}`, "--sequence", "--image-format=png", `--public-dir=${FONTS}`, "--log=error"],
        root,
        30 * 60_000,
      );
      const frames = (await readdir(seq)).filter((f) => f.endsWith(".png")).sort();
      if (!frames.length) throw new Error("o Remotion não gerou quadros");
      const digits = frames[0].match(/(\d+)\.png$/)?.[1].length ?? 3;
      await exec(
        FFMPEG,
        [
          "-y", "-v", "error",
          "-i", opts.video,
          "-framerate", "30", "-i", path.join(seq, `element-%0${digits}d.png`),
          "-filter_complex", "[0:v][1:v]overlay=0:0:eof_action=pass,format=yuv420p[v]",
          "-map", "[v]", "-map", "0:a?",
          "-c:v", "libx264", "-r", "30", "-pix_fmt", "yuv420p", ...saida,
          "-c:a", "copy", "-movflags", "+faststart",
          tmp,
        ],
        root,
        15 * 60_000,
      );
      opts.log("camada visual aplicada");
    } catch (err) {
      if (!ass || !(props.legenda?.blocos.length || props.slams?.length)) throw err;
      opts.log(`o Remotion falhou (${err instanceof Error ? err.message.slice(0, 200) : "erro"}); legenda pelo desenho antigo do ffmpeg`);
      await queimarAss(opts.video, tmp, ass, props, opts.workdir, saida);
      opts.log("legenda aplicada pelo ffmpeg (sem setas, barra e gráficos animados)");
    }
    await rename(tmp, opts.video);
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
    await rm(opts.workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Outra composição do Remotion sobre o vídeo (substitui o arquivo), do mesmo jeito da camada: quadros em PNG
// transparente, sobrepostos pelo ffmpeg do sistema com o áudio intacto. Usada pelo reel do Instagram
// (remotion/ReelInstagram.tsx). Sem reserva: se o Remotion falhar, lança o erro.
export async function sobreporComposicao(opts: { video: string; composicao: string; props: Record<string, unknown>; fps: number; workdir: string; log: (m: string) => void }) {
  await mkdir(opts.workdir, { recursive: true });
  const tmp = `${opts.video}.gfx.mp4`;
  const root = process.cwd();
  try {
    const seq = path.join(opts.workdir, "camada");
    const arquivoProps = path.join(opts.workdir, "camada.json");
    await writeFile(arquivoProps, JSON.stringify(opts.props));
    opts.log(`textos na tela pelo Remotion (${opts.composicao})`);
    const cli = path.join(root, "node_modules", "@remotion", "cli", "remotion-cli.js");
    await exec(
      process.execPath,
      [cli, "render", "remotion/index.ts", opts.composicao, seq, `--props=${arquivoProps}`, "--sequence", "--image-format=png", `--public-dir=${FONTS}`, "--log=error"],
      root,
      30 * 60_000,
    );
    const frames = (await readdir(seq)).filter((f) => f.endsWith(".png")).sort();
    if (!frames.length) throw new Error("o Remotion não gerou quadros");
    const digits = frames[0].match(/(\d+)\.png$/)?.[1].length ?? 3;
    await exec(
      FFMPEG,
      [
        "-y", "-v", "error",
        "-i", opts.video,
        "-framerate", String(opts.fps), "-i", path.join(seq, `element-%0${digits}d.png`),
        "-filter_complex", "[0:v][1:v]overlay=0:0:eof_action=pass,format=yuv420p[v]",
        "-map", "[v]", "-map", "0:a?",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", ...(await qualidade(opts.video)),
        "-c:a", "copy", "-movflags", "+faststart",
        tmp,
      ],
      root,
      15 * 60_000,
    );
    await rename(tmp, opts.video);
    opts.log("textos aplicados");
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
    await rm(opts.workdir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Reserva: a legenda (e a faixa do aviso) pelo filtro ass do ffmpeg, como antes do Remotion.
async function queimarAss(video: string, destino: string, ass: string, props: CamadaProps, workdir: string, saida: string[]) {
  const pasta = path.join(workdir, "ass");
  await mkdir(pasta, { recursive: true });
  await writeFile(path.join(pasta, "s.ass"), ass, "utf8");
  await cp(FONTS, path.join(pasta, "fonts"), { recursive: true });
  const faixa = props.aviso ? `drawbox=x=0:y=${props.aviso.topo}:w=iw:h=ih-${props.aviso.topo}:color=black@0.985:t=fill,` : "";
  // Caminhos relativos (cwd = pasta do ASS): o filtro ass não lida bem com "C:\" do Windows.
  await exec(
    FFMPEG,
    ["-y", "-v", "error", "-i", video, "-vf", `${faixa}ass=s.ass:fontsdir=fonts,format=yuv420p`, "-map", "0:v", "-map", "0:a?",
      "-c:v", "libx264", "-r", "30", "-pix_fmt", "yuv420p", ...saida, "-c:a", "copy", "-movflags", "+faststart", destino],
    pasta,
    15 * 60_000,
  );
}

// Qualidade da saída: mestre (a entrega do Sávio vem depois) ou já com o teto de tamanho (piso de 900 kbps).
async function qualidade(video: string, limiteMb?: number, crf = 16): Promise<string[]> {
  if (!limiteMb) return ["-preset", "veryfast", "-crf", String(crf)];
  const dur = await duracaoDe(video);
  const teto = Math.max(900, Math.min(12000, Math.floor((limiteMb * 1e6 * 8 * 0.96) / Math.max(1, dur) / 1000) - 128));
  return ["-preset", "medium", "-crf", "20", "-maxrate", `${teto}k`, "-bufsize", `${2 * teto}k`, "-profile:v", "high"];
}

function duracaoDe(file: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.env.FFPROBE_BIN || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", () => resolve(0));
    child.on("close", () => resolve(Number(out.trim()) || 0));
  });
}
