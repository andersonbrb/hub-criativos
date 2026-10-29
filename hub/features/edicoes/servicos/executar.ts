import "server-only";

import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";

import { MARCA_DA_ENTRADA, MARCA_DA_PASTA, MARCA_DA_SAIDA, NOME_VALIDO, type Trabalho } from "@/features/edicoes/contrato";
import { placeCaptions, placeClips, type EditorProject } from "@/lib/editor";
import { aplicarCamada, posicionarGraficos, sobreporComposicao, type CamadaDoVideo, type GraphicRequest } from "@/lib/server/motion";
import type { Legenda, Palavra } from "@/remotion/Camada";

// O trabalho pesado das edições: Python (scripts/montagem.py, batida.py, remover_legenda.py, transcrever.py), ffmpeg e
// Remotion. Roda no servidor de edições (servicos/servidor.ts) ou, sem ele, no próprio site (servicos/rodar.ts), com o
// mesmo resultado. Só lê e grava os arquivos que recebe: nada de gerações, organizações ou Google Drive aqui (o servidor
// de edições não tem banco nem Drive).

const PYTHON = () => process.env.PYTHON_BIN || "python";
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";
const SCRIPTS = path.join(process.cwd(), "scripts");
const FONTS = path.join(SCRIPTS, "fonts");
// Modelo do LaMa: baixado no 1º uso para a pasta de dados de quem roda (no Railway, o volume de cada serviço).
const LAMA_MODEL = path.join(process.cwd(), ".data", "models", "big-lama.pt");

// Onde ficam os arquivos de um trabalho (os marcadores de contrato.ts viram estes caminhos).
export type Caminhos = { entrada: (nome: string) => string; saida: string; pasta: (nome: string) => string };

// Registro da edição (a tela mostra): `bruto` recebe a saída dos scripts como vem; `linha` põe a hora na frente.
export type Registro = { bruto: (texto: string) => void; linha: (m: string) => void };

export const linhaComHora = (m: string) => `[${new Date().toLocaleTimeString("pt-BR")}] ${m}\n`;

export function nomeValido(nome: string): string {
  if (!NOME_VALIDO.test(nome)) throw new Error(`nome de arquivo inválido no trabalho: ${nome.slice(0, 40)}`);
  return nome;
}

// Troca os marcadores ("@entrada/x", "@saida", "@pasta/x") pelos caminhos de quem roda.
export function resolverMarcadores<T>(valor: T, c: Caminhos): T {
  if (typeof valor === "string") {
    if (valor === MARCA_DA_SAIDA) return c.saida as T;
    if (valor.startsWith(MARCA_DA_ENTRADA)) return c.entrada(nomeValido(valor.slice(MARCA_DA_ENTRADA.length))) as T;
    if (valor.startsWith(MARCA_DA_PASTA)) return c.pasta(nomeValido(valor.slice(MARCA_DA_PASTA.length))) as T;
    return valor;
  }
  if (Array.isArray(valor)) return valor.map((v) => resolverMarcadores(v, c)) as T;
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, resolverMarcadores(v, c)])) as T;
  }
  return valor;
}

// Roda um trabalho até o fim. O vídeo pronto fica em `c.saida`; a transcrição devolve a saída do Whisper em `resultado`.
// Falhou: lança com a frase para a pessoa (sem o rótulo da edição) e não deixa vídeo pela metade.
export async function executarTrabalho(t: Trabalho, c: Caminhos, log: Registro): Promise<{ resultado?: string }> {
  switch (t.tipo) {
    case "montagem":
      await montagem(t.dados, c, log);
      return {};
    case "batida":
      await batida(t.dados, c, log);
      return {};
    case "sem-legenda":
      await semLegenda(t.dados, c, log);
      return {};
    case "editor":
      await editor(t.dados, c, log);
      return {};
    case "instagram-reel":
      await reelInstagram(t.dados, c, log);
      return {};
    case "transcricao":
      return { resultado: await transcricao(t.dados, c) };
    default:
      throw new Error(`tipo de trabalho desconhecido: ${String((t as { tipo?: unknown }).tipo).slice(0, 30)}`);
  }
}

// ---------- Arquivos que sobram ----------

// Intermediários que o script e a camada gravam ao lado do vídeo (".gfx.mp4" da camada, ".tmp.mp4" da entrega).
const tirarIntermediarios = (saida: string) =>
  Promise.all([rm(`${saida}.gfx.mp4`, { force: true }), rm(`${saida}.tmp.mp4`, { force: true })]).catch(() => undefined);
// Com erro, o vídeo pela metade sai também (regra do dono: vídeo fora do Drive não fica).
const tirarSobras = (saida: string) => Promise.all([rm(saida, { force: true }).catch(() => undefined), tirarIntermediarios(saida)]);

// ---------- Python ----------

// Processadores que este serviço pode usar de verdade. No Railway o contêiner enxerga todos os da máquina (48), mas só
// pode usar o limite do serviço (8 no servidor de edições).
function processadoresDoServico(): number {
  try {
    const [cota, periodo] = readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim().split(/\s+/);
    if (cota !== "max" && Number(cota) > 0 && Number(periodo) > 0) return Math.max(1, Math.floor(Number(cota) / Number(periodo)));
  } catch {
    // Fora de contêiner (o PC): vale o que a máquina tem.
  }
  return availableParallelism();
}

// O PyTorch do LaMa (remover legenda) abre uma linha de trabalho por processador da máquina: com 48 num serviço de 8,
// cada quadro levava ~85 s em vez de menos de 1 s (medido em 28/10/2026). Cada edição fica com a sua parte.
const LINHAS_POR_EDICAO = String(Math.max(1, Math.floor(processadoresDoServico() / (Number(process.env.HUB_EDICOES_SIMULTANEAS) || 2))));

// Roda um script da edição: a saída vai para o registro; termina bem só com código 0 e "DONE" no registro.
function rodarPython(script: string, jobFile: string, log: Registro): Promise<void> {
  return new Promise((resolve, reject) => {
    let texto = "";
    const env = { ...process.env, PYTHONIOENCODING: "utf-8", OMP_NUM_THREADS: LINHAS_POR_EDICAO, MKL_NUM_THREADS: LINHAS_POR_EDICAO };
    const child = spawn(PYTHON(), ["-W", "ignore", script, jobFile], { windowsHide: true, env });
    child.stdin.end();
    const collect = (chunk: Buffer) => {
      const parte = chunk.toString("utf8");
      texto += parte;
      log.bruto(parte);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (err) => reject(new Error(`Não consegui rodar o Python (${err.message}). Defina PYTHON_BIN no .env.local.`)));
    child.on("close", (code) => {
      if (code === 0 && texto.includes("DONE")) return resolve();
      const missing = /No module named '(torch|cv2)'/.exec(texto)?.[1];
      const err = missing
        ? `falta instalar ${missing === "cv2" ? "o OpenCV" : "o PyTorch"} neste servidor (pip install torch opencv-python-headless); por enquanto isso roda no PC`
        : (texto.match(/ERROR (.+)/)?.[1] ?? texto.trim().split("\n").slice(-2).join(" "));
      reject(new Error(err.slice(0, 300) || `saiu com código ${code}`));
    });
  });
}

async function gravarJob(jobFile: string, job: Record<string, unknown>) {
  await mkdir(path.dirname(jobFile), { recursive: true });
  await writeFile(jobFile, JSON.stringify(job));
}

// Camada visual pelo Remotion (legenda, aviso, barra, setas e gráficos): sem ela o vídeo não é entregue.
async function comCamada(camadaFile: string, fn: (camada: CamadaDoVideo) => Promise<void>) {
  try {
    await fn(JSON.parse(await readFile(camadaFile, "utf8")) as CamadaDoVideo);
  } catch (err) {
    throw new Error(`a legenda não saiu (${err instanceof Error ? err.message.slice(0, 250) : "erro"})`);
  } finally {
    await rm(camadaFile, { force: true }).catch(() => undefined);
  }
}

// ---------- Edição final (scripts/montagem.py) ----------

type JobDaMontagem = Record<string, unknown> & {
  out: string;
  workdir: string;
  camada_out: string;
  timeline_out: string;
  avatar_words?: [string, number, number][][] | null;
};

const SCRIPT_DA_MONTAGEM = path.join(SCRIPTS, "montagem.py");

async function montagem(dados: Record<string, unknown>, c: Caminhos, log: Registro) {
  const d = resolverMarcadores(dados, c) as {
    job: JobDaMontagem;
    narracao?: { audio: string; brolls: string[]; cues: string[] } | null;
    graficos?: GraphicRequest[];
    foraDoFormato?: string | null;
  };
  const job: JobDaMontagem = { ...d.job, fontsdir: FONTS };
  const jobFile = c.pasta("job.json");
  try {
    if (d.narracao) {
      // Sem avatar: a base fica na pasta de trabalho, que o script apaga no fim.
      const base = path.join(job.workdir, "base-narracao.mp4");
      const words = (job.avatar_words?.[0] ?? []).map(([text, start]) => ({ text, start }));
      await montarBaseDaNarracao({ audio: d.narracao.audio, brolls: d.narracao.brolls, cues: d.narracao.cues, words, out: base });
      Object.assign(job, { avatar: base, avatars: [base], brolls: [], broll_cues: [] });
    }
    await gravarJob(jobFile, job);
    await rodarPython(SCRIPT_DA_MONTAGEM, jobFile, log);
    if (d.foraDoFormato) log.linha(`gráficos animados ficaram de fora: eles são desenhados só para o 9:16 (este é ${d.foraDoFormato})`);
    // O Python entrega um mestre limpo de 1080 e os dados da camada; o Remotion desenha a camada (legenda, aviso, barra,
    // setas e os gráficos animados opcionais) num desenho só.
    await comCamada(job.camada_out, async (camada) => {
      const elementos = await posicionarGraficos(d.graficos ?? [], job.timeline_out, log.linha).catch((err) => {
        log.linha(`gráficos animados ficaram de fora (${err instanceof Error ? err.message.slice(0, 120) : "erro"})`);
        return [];
      });
      await aplicarCamada({ video: job.out, camada: { ...camada, elementos }, workdir: c.pasta("camada"), log: log.linha });
    });
    // Entrega no padrão do Sávio depois da camada (resolução e limite de 30 MB).
    await entregarDepoisDosGraficos(jobFile, log.linha);
    await tirarIntermediarios(job.out);
  } catch (err) {
    await tirarSobras(job.out);
    throw err;
  }
}

// Entrega do Sávio (720/1080 de largura, até 30 MB) do vídeo que já recebeu a camada: roda `montagem.py --finalizar`
// no mesmo arquivo. Se falhar, o mestre de 1080 fica como está e o registro explica.
function entregarDepoisDosGraficos(jobFile: string, line: (m: string) => void): Promise<void> {
  const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
  return new Promise((resolve) => {
    execFile(PYTHON(), ["-W", "ignore", SCRIPT_DA_MONTAGEM, "--finalizar", jobFile], { windowsHide: true, timeout: 30 * 60_000, maxBuffer: 10 * 1024 * 1024, env }, (err, stdout) => {
      const saida = String(stdout ?? "");
      for (const l of saida.split("\n").filter((x) => x.trim() && !x.includes("DONE"))) line(l.replace(/^\[[\d:]+\]\s*/, ""));
      if (err) line(`a entrega final falhou (${(saida.match(/ERROR (.+)/)?.[1] ?? err.message).slice(0, 200)}); o vídeo fica em 1080`);
      resolve();
    });
  });
}

const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

// Segundo em que a deixa é falada (a partir de `depois`), ou null.
function tempoDaDeixa(deixa: string, words: { text: string; start: number }[], depois: number): number | null {
  const alvo = normal(deixa);
  if (!alvo.length) return null;
  const ws = words.flatMap((w) => normal(w.text).map((t) => ({ t, s: w.start })));
  for (let i = 0; i < ws.length; i++) {
    if (ws[i].s < depois) continue;
    if (alvo.every((a, k) => ws[i + k]?.t.startsWith(a))) return ws[i].s;
  }
  return null;
}

// Edição sem avatar: monta um vídeo-base 1080x1920 com os b-rolls cobrindo a narração inteira, e ele entra no lugar
// do avatar (cortes de silêncio, legenda, música e entrega seguem iguais). Com deixas, cada b-roll entra na palavra
// dele e fica até o próximo; sem deixas, os b-rolls se revezam em trechos de até 3,5 s.
async function montarBaseDaNarracao(opts: { audio: string; brolls: string[]; cues: string[]; words: { text: string; start: number }[]; out: string }) {
  const D = await duracaoDoArquivo(opts.audio);
  if (!D) throw new Error("não consegui ler a duração da narração");
  const durs = await Promise.all(opts.brolls.map((b) => duracaoDoArquivo(b)));
  const n = opts.brolls.length;
  type Trecho = { b: number; ini: number; dur: number; off: number };
  const trechos: Trecho[] = [];
  const comDeixa: { t: number; b: number }[] = [];
  if (opts.cues.some(Boolean)) {
    let depois = 0;
    for (let b = 0; b < n; b++) {
      const t = b === 0 ? 0 : opts.cues[b] ? tempoDaDeixa(opts.cues[b], opts.words, depois) : null;
      if (t === null || t >= D) continue;
      comDeixa.push({ t, b });
      depois = t + 0.5;
    }
  }
  if (comDeixa.length > 1) {
    comDeixa.forEach((x, k) => trechos.push({ b: x.b, ini: x.t, dur: (comDeixa[k + 1]?.t ?? D) - x.t, off: 0 }));
  } else {
    const k = Math.max(n, Math.ceil(D / 3.5));
    const len = D / k;
    for (let j = 0; j < k; j++) {
      const b = j % n;
      const volta = Math.floor(j / n);
      trechos.push({ b, ini: j * len, dur: len, off: durs[b] > len ? (volta * len) % Math.max(0.01, durs[b] - len) : 0 });
    }
  }
  const args = ["-y", "-v", "error"];
  for (const t of trechos) args.push("-stream_loop", "-1", "-i", opts.brolls[t.b]);
  args.push("-i", opts.audio);
  const filtros = trechos.map(
    (t, i) =>
      `[${i}:v]trim=start=${t.off.toFixed(3)}:duration=${t.dur.toFixed(3)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v${i}]`,
  );
  const grafo = `${filtros.join(";")};${trechos.map((_, i) => `[v${i}]`).join("")}concat=n=${trechos.length}:v=1:a=0[v]`;
  args.push("-filter_complex", grafo, "-map", "[v]", "-map", `${trechos.length}:a`, "-t", D.toFixed(3));
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", opts.out);
  await mkdir(path.dirname(opts.out), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    execFile(FFMPEG, args, { windowsHide: true, timeout: 20 * 60_000, maxBuffer: 10 * 1024 * 1024 }, (err, _o, stderr) =>
      err ? reject(new Error(String(stderr || err.message).trim().split("\n").slice(-3).join(" "))) : resolve(),
    );
  });
  return trechos.length;
}

// Duração do arquivo em segundos; 0 se o ffprobe falhar.
export function duracaoDoArquivo(file: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { windowsHide: true }, (err, out) =>
      resolve(err ? 0 : Number(String(out).trim()) || 0),
    );
  });
}

// ---------- Edição na batida (scripts/batida.py) ----------

async function batida(dados: Record<string, unknown>, c: Caminhos, log: Registro) {
  const d = resolverMarcadores(dados, c) as { job: Record<string, unknown> & { out: string; camada_out: string } };
  const job = { ...d.job, fontsdir: FONTS };
  const jobFile = c.pasta("job.json");
  try {
    await gravarJob(jobFile, job);
    await rodarPython(path.join(SCRIPTS, "batida.py"), jobFile, log);
    // As palavras gigantes saem pelo Remotion, por cima do vídeo já com os efeitos; até 30 MB (contexto do Sávio).
    await comCamada(job.camada_out, (camada) => aplicarCamada({ video: job.out, camada, workdir: c.pasta("camada"), log: log.linha, limiteMb: 30 }));
    await tirarIntermediarios(job.out);
  } catch (err) {
    await tirarSobras(job.out);
    throw err;
  }
}

// ---------- Remover legenda (scripts/remover_legenda.py, LaMa) ----------

async function semLegenda(dados: Record<string, unknown>, c: Caminhos, log: Registro) {
  const d = resolverMarcadores(dados, c) as { job: Record<string, unknown> & { out: string } };
  const jobFile = c.pasta("job.json");
  try {
    await gravarJob(jobFile, { ...d.job, model: LAMA_MODEL });
    await rodarPython(path.join(SCRIPTS, "remover_legenda.py"), jobFile, log);
    await tirarIntermediarios(d.job.out);
  } catch (err) {
    await tirarSobras(d.job.out);
    throw err;
  }
}

// ---------- Reel do Instagram (os textos do Padrão de Edição pelo Remotion) ----------

// O vídeo traduzido sai com o gancho, a headline, as legendas e o CTA que o diretor de edição montou
// (features/instagram/servidor/composition/production/editing-stage.ts).
async function reelInstagram(dados: Record<string, unknown>, c: Caminhos, log: Registro) {
  const d = resolverMarcadores(dados, c) as { video: string; props: Record<string, unknown> & { fps?: number } };
  await mkdir(path.dirname(c.saida), { recursive: true });
  try {
    await copyFile(d.video, c.saida);
    await sobreporComposicao({ video: c.saida, composicao: "ReelInstagram", props: d.props, fps: Number(d.props.fps) || 30, workdir: c.pasta("camada"), log: log.linha });
  } catch (err) {
    await tirarSobras(c.saida);
    throw err;
  }
}

// ---------- Exportação do editor (ffmpeg + legenda pelo Remotion) ----------

async function editor(dados: Record<string, unknown>, c: Caminhos, log: Registro) {
  const d = resolverMarcadores(dados, c) as { projeto: EditorProject; fontes: Record<string, string> };
  const project = d.projeto;
  const { clips, total } = placeClips(project);
  const { width: W, height: H, fps } = project;
  const tmp = c.pasta("trabalho");
  await mkdir(tmp, { recursive: true });
  await mkdir(path.dirname(c.saida), { recursive: true });
  try {
    const args = ["-y", "-loglevel", "error"];
    const filters: string[] = [];
    const concatInputs: string[] = [];
    let input = 0;
    clips.forEach((clip, i) => {
      const src = project.sources[clip.sourceId];
      const fonte = d.fontes[clip.sourceId];
      if (!fonte) throw new Error("um vídeo da timeline não chegou para a exportação");
      args.push("-ss", clip.in.toFixed(3), "-t", clip.duration.toFixed(3), "-i", fonte);
      const vi = input++;
      filters.push(
        `[${vi}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`,
      );
      if (src.hasAudio) {
        filters.push(`[${vi}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        args.push("-f", "lavfi", "-t", clip.duration.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
        filters.push(`[${input++}:a]asetpts=PTS-STARTPTS[a${i}]`);
      }
      concatInputs.push(`[v${i}][a${i}]`);
    });
    filters.push(`${concatInputs.join("")}concat=n=${clips.length}:v=1:a=1[vc][ac]`);

    // A legenda sai pelo Remotion depois do corte (regra do dono, 27/10/2026), como na prévia do editor.
    const comLegenda = project.captionsEnabled && placeCaptions(project).length > 0;
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", "[vc]", "-map", "[ac]",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", comLegenda ? "16" : "20",
      // Áudio no padrão de entrega do Sávio: AAC 48 kHz estéreo 128k.
      "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      c.saida,
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(FFMPEG, args, { cwd: tmp, windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
      child.on("error", (e) => reject((e as NodeJS.ErrnoException).code === "ENOENT" ? new Error("ffmpeg não encontrado. Instale o ffmpeg ou defina FFMPEG_BIN.") : e));
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${stderr.trim().split("\n").slice(-3).join(" ")}`))));
    });
    if (comLegenda) {
      // Se o Remotion falhar, a legenda sai pelo ASS de antes (buildAss).
      const camada: CamadaDoVideo = { duracao: total, altura: H, largura: W, legenda: legendaDoEditor(project), ass: buildAss(project) };
      await aplicarCamada({ video: c.saida, camada, workdir: path.join(tmp, "camada"), log: log.linha, crf: 20 });
    }
  } catch (err) {
    await tirarSobras(c.saida);
    throw err;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

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

// ---------- Transcrição (scripts/transcrever.py, Whisper local) ----------

// Devolve a saída do script como veio (o site lê o JSON da última linha, como sempre).
async function transcricao(dados: Record<string, unknown>, c: Caminhos): Promise<string> {
  const d = resolverMarcadores(dados, c) as { audio: string };
  // PYTHONUTF8: no Windows o Python escreveria o JSON em cp1252 e os acentos chegariam quebrados.
  const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
  return new Promise((resolve, reject) => {
    // Até 1 h: um VSL de 40 min no Whisper "small" em CPU passa fácil dos 15 min.
    const child = execFile(PYTHON(), ["-W", "ignore", path.join(SCRIPTS, "transcrever.py"), d.audio], { timeout: 3_600_000, maxBuffer: 50 * 1024 * 1024, windowsHide: true, encoding: "utf8", env }, (err, stdout, stderr) => {
      if (err) reject(new Error((stdout || stderr || err.message).trim().split("\n").slice(-3).join(" ")));
      else resolve(stdout);
    });
    child.stdin?.end();
  });
}
