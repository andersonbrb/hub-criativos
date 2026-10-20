import "server-only";

import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { segurarTemp, soltarTemp } from "@/features/drive/servicos/arquivos";
import { apagarDaMidia, arquivoLocal, concluirComArquivo, exigirDriveParaVideo } from "@/features/drive/servicos/videos";
import type { Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { applyGraphics, sanitizeGraphics, type GraphicRequest } from "@/lib/server/motion";
import { comOrganizacao, organizacaoDoContexto } from "@/features/acesso/servicos/organizacao-atual";
import { DATA_DIR, pastaDeMidia } from "@/lib/server/pastas";
import { createGeneration, getGeneration, updateGeneration } from "@/lib/server/store";
import { palavrasDaFala } from "@/lib/server/video";

// Edição final (playbook infoproduto-edicao-video e contexto do Sávio), rodando nesta máquina:
// Python + faster-whisper + ffmpeg (scripts/montagem.py). Não gasta créditos de nenhuma ferramenta.

const SCRIPT = path.join(process.cwd(), "scripts", "montagem.py");
const BEAT_SCRIPT = path.join(process.cwd(), "scripts", "batida.py");
const CAPTION_SCRIPT = path.join(process.cwd(), "scripts", "remover_legenda.py");
// Modelo e temporários são de todas as organizações (raiz de .data/). O vídeo pronto vai para as mídias da organização.
const LAMA_MODEL = path.join(DATA_DIR, "models", "big-lama.pt");
const FONTS = path.join(process.cwd(), "scripts", "fonts");
// Logs por id da geração (uuid): só são lidos depois de a rota achar a geração na organização de quem pede.
const LOG_DIR = path.join(DATA_DIR, "montagem");
export const LANGS = ["es", "pt", "fr", "en"] as const;

export const logPath = (id: string) => path.join(LOG_DIR, `${id}.log`);

// Montagens rodando neste processo do servidor (sobrevive ao hot reload do dev).
const running: Set<string> = ((globalThis as { __montagens?: Set<string> }).__montagens ??= new Set());

// A edição desta geração está rodando neste processo (a faxina não apaga a pasta de trabalho dela).
export const montagemRodando = (id: string) => running.has(id);

// Cópias temporárias do Drive (arquivoLocal) ficam seguras da limpeza enquanto o Python trabalha: um trabalho longo
// passa horas sem tocar no arquivo. Soltas no fim, com sucesso ou com erro. Se algo impedir de soltar, a trava vence
// sozinha depois de 12 h.
const SEGURA_COPIAS_MS = 12 * 60 * 60 * 1000;

async function copiaSegura(file: string, copias: string[]): Promise<string> {
  const caminho = await arquivoLocal(file);
  segurarTemp(caminho, SEGURA_COPIAS_MS);
  copias.push(caminho);
  return caminho;
}

// Esvazia a lista: chamar duas vezes (erro e fim do processo) solta cada cópia uma vez só.
function soltarCopias(copias: string[]) {
  for (const caminho of copias.splice(0)) soltarTemp(caminho);
}

// avatarIds: vários vídeos do avatar, juntados na ordem antes dos cortes (gancho + body, várias tomadas).
// avatarId continua valendo (um só), para o chat e chamadas antigas.
// brollCues: "deixa" de cada b-roll (mesma ordem de brollIds): palavra/frase falada em que ele entra. Vazia = depois
// de ~10–15 s de avatar (regra do Sávio).
// fx: efeitos (scripts/montagem.py, FX_DEFAULTS). O padrão segue o contexto do Sávio (decisão de 20/10/2026):
// legenda "drop" com palavra-chave em amarelo, troca de plano a cada 1,1–4 s, b-roll em corte seco, voz -15 LUFS e
// final -14 LUFS. musicId = áudio do hub para fundo (sempre -32 LUFS sob a fala, com ducking de 11 dB: sem volume livre).
// roteiro: texto falado; a legenda usa o texto dele (sem ele, o hub tenta o texto da narração que gerou o avatar).
// formato/resolucao/limiteMb: entrega do Sávio (9:16, 4:5 ou 1:1; 720 para origem baixa, 1080 caso contrário; até 30 MB).
// cta: as 2 setas vermelhas do Sávio entram na palavra do CTA (ou no segundo `inicio`) e ficam até o fim.
// aviso: texto pequeno numa faixa opaca no rodapé (ex.: "Solo con fines demostrativos. Algunas escenas están aceleradas.").
// graphics: gráficos animados com Remotion (lib/server/motion.ts), aplicados depois da edição (só no 9:16).
export type MontageFx = {
  estilo?: "drop" | "sb";
  legenda?: "bloco" | "palavra" | "padrao" | "destaque";
  // Caixa alta na legenda (o kit do Sávio não diz no estilo drop; o Vinícius decide o padrão).
  maiusculas?: boolean;
  // Antigo (antes do Sávio): a palavra-chave agora é sempre amarela.
  cor_destaque?: string;
  zoom_cortes?: boolean;
  transicao?: "corte" | "dissolve" | "zoom" | "slide";
  whoosh?: boolean;
  musicId?: string;
  // Antigo: ignorado (o nível da música é sempre o do Sávio).
  musica_volume?: number;
  cor?: "nenhuma" | "quente" | "fria" | "vivo";
  barra_progresso?: boolean;
};
export const FORMATOS = ["9:16", "4:5", "1:1"] as const;
export const RESOLUCOES = ["auto", "720", "1080"] as const;
export type MontageRequest = {
  avatarId?: string;
  avatarIds?: string[];
  brollIds?: string[];
  brollCues?: string[];
  lang?: string;
  name?: string;
  fx?: MontageFx;
  graphics?: GraphicRequest[];
  roteiro?: string;
  formato?: (typeof FORMATOS)[number];
  resolucao?: (typeof RESOLUCOES)[number];
  limiteMb?: number;
  cta?: { palavra?: string; inicio?: number };
  aviso?: string;
};

// Só o que é válido e diferente do padrão do script. A música entra em `copias` (soltas no fim do trabalho).
async function cleanFx(fx: MontageFx | undefined, copias: string[]) {
  if (!fx || typeof fx !== "object") return { fx: {}, labels: [] as string[] };
  const out: Record<string, unknown> = {};
  const labels: string[] = [];
  const set = (key: string, value: unknown, label: string) => {
    out[key] = value;
    labels.push(label);
  };
  if (fx.estilo === "sb") set("estilo", "sb", "legenda sb (Anton)");
  if (fx.legenda === "palavra") set("legenda", "palavra", "legenda palavra a palavra");
  if (fx.maiusculas === true) set("maiusculas", true, "legenda em maiúsculas");
  if (fx.zoom_cortes === false) set("zoom_cortes", false, "sem troca de enquadramento");
  if (fx.transicao === "dissolve" || fx.transicao === "zoom" || fx.transicao === "slide") set("transicao", fx.transicao, `transição ${fx.transicao}`);
  if (fx.whoosh === true) set("whoosh", true, "whoosh nas entradas de b-roll");
  if (fx.cor === "quente" || fx.cor === "fria" || fx.cor === "vivo") set("cor", fx.cor, `cor ${fx.cor}`);
  if (fx.barra_progresso === true) set("barra_progresso", true, "barra de progresso");
  if (fx.musicId) {
    const m = await getGeneration(String(fx.musicId));
    if (!m?.file || m.kind !== "audio") throw new InputError("A música precisa ser um áudio pronto do hub.");
    out.musica = await copiaSegura(m.file, copias);
    labels.push("música de fundo (-32 LUFS sob a fala)");
  }
  return { fx: out, labels };
}

// Tags de emoção do ElevenLabs ([excited]…) não são faladas: saem do roteiro da legenda.
const semTags = (t: string) => t.replace(/\[[^\]\n]{1,40}\]/g, " ").replace(/\s+/g, " ").trim();

// Roteiro da legenda: o pedido manda; sem ele, o texto da narração ou do roteiro que gerou cada vídeo do avatar no
// HeyGen (todos precisam ter, senão a legenda sai da fala).
function roteiroDosAvatares(avatars: { g: Generation }[]): string | null {
  const partes = avatars.map(({ g }) => (g.tool === "heygen" && (g.params.mode === "audio" || g.params.mode === "script") ? semTags(g.prompt) : ""));
  return partes.every(Boolean) ? partes.join(" ") : null;
}

const MAX_AVATARS = 20;
const MAX_BROLLS = 40;

// Vídeo pronto do hub. `file` é o nome; o caminho no disco sai de arquivoLocal já em segundo plano, porque um vídeo
// que está só no Google Drive é baixado antes e o pedido não espera o download.
async function videoFile(id: string, label: string) {
  const g = await getGeneration(id);
  if (g?.foraDoDrive) throw new InputError(`${label} foi apagado no Drive.`);
  if (!g || g.kind !== "video" || g.status !== "done" || !g.file) throw new InputError(`${label} precisa ser um vídeo pronto do hub.`);
  return { g, file: g.file };
}

export async function runMontage(req: MontageRequest): Promise<Generation> {
  // Regra do dono: o vídeo pronto vai só para o Drive. Sem Drive conectado, nem começa.
  await exigirDriveParaVideo();
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
  // Nome no padrão do Sávio ("AD 01 - OFERTA-FORMATO-VOZ/IDIOMA-VARIAÇÃO"): vira o nome do arquivo e do anúncio.
  const nomeDado = String(req.name ?? "").trim().replace(/[^\w\- ]+/g, "_").replace(/\s+/g, " ").slice(0, 80);
  const name = nomeDado || "AD";
  const copias: string[] = [];
  const { fx, labels } = await cleanFx(req.fx, copias);
  const formato = FORMATOS.includes(req.formato as (typeof FORMATOS)[number]) ? (req.formato as string) : "9:16";
  const resolucao = RESOLUCOES.includes(String(req.resolucao) as (typeof RESOLUCOES)[number]) ? String(req.resolucao) : "auto";
  const limiteMb = Math.min(500, Math.max(5, Number(req.limiteMb) || 30));
  const roteiroPedido = semTags(String(req.roteiro ?? "")).slice(0, 20_000);
  const roteiro = roteiroPedido || roteiroDosAvatares(avatars);
  const aviso = String(req.aviso ?? "").replace(/[{}\\\n]/g, " ").trim().slice(0, 160) || null;
  // O CTA do Sávio são as 2 setas vermelhas (sem botão): o gráfico "cta" vira as setas da própria edição.
  const todos = sanitizeGraphics(req.graphics);
  const ctaGrafico = todos.find((g) => g.tipo === "cta");
  const palavraCta = String(req.cta?.palavra ?? ctaGrafico?.deixa ?? "").trim().slice(0, 60);
  const inicioCta = Number.isFinite(Number(req.cta?.inicio)) && req.cta?.inicio !== undefined ? Number(req.cta.inicio) : ctaGrafico?.inicio;
  const cta = req.cta || ctaGrafico ? { ...(palavraCta ? { palavra: palavraCta } : {}), ...(Number.isFinite(inicioCta) ? { inicio: inicioCta } : {}) } : null;
  // Os gráficos animados são desenhados para o 9:16; nos outros formatos ficam de fora (o registro avisa).
  const pedidos = todos.filter((g) => g.tipo !== "cta");
  const graphics = formato === "9:16" ? pedidos : [];

  const gen = await createGeneration({
    tool: "montagem",
    kind: "video",
    status: "running",
    ...(nomeDado ? { name } : {}),
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
      formato,
      resolucao,
      legendaPeloRoteiro: Boolean(roteiro),
      efeitos: labels.join(", ") || null,
      graficos: graphics.length ? graphics.map((g) => g.tipo).join(", ") : null,
      cta: cta ? (cta.palavra ?? `${cta.inicio}s`) : null,
      aviso,
    },
  });

  await mkdir(LOG_DIR, { recursive: true });
  const midia = await pastaDeMidia();
  await mkdir(midia, { recursive: true });
  const outName = `${randomUUID()}.mp4`;
  const jobFile = path.join(LOG_DIR, `${gen.id}.json`);
  const timelineFile = path.join(LOG_DIR, `${gen.id}.timeline.json`);
  const entregaFile = path.join(LOG_DIR, `${gen.id}.entrega.json`);
  // Em segundo plano: primeiro as palavras com tempo da fala ORIGINAL de cada vídeo do avatar (transcrição em cache ou
  // Whisper local, um por vez, como no contexto do Sávio), depois o Python. Sem elas, o script transcreve sozinho.
  running.add(gen.id);
  void (async () => {
    const avatarWords = await Promise.all(
      avatarIds.map(async (id) => {
        const words = await palavrasDaFala(id);
        return words.map((w) => [w.text, w.start, w.end] as const);
      }),
    ).catch((err) => {
      console.warn(`[hub] montagem ${gen.id}: palavras indisponíveis (${err instanceof Error ? err.message : err}), o script transcreve`);
      return null;
    });
    // Caminhos no disco para o Python (vídeo que está só no Drive vira uma cópia temporária, segura até o fim).
    const avatarFiles = await Promise.all(avatars.map((a) => copiaSegura(a.file, copias)));
    const brollFiles = await Promise.all(brolls.map((b) => copiaSegura(b.file, copias)));

    await writeFile(
      jobFile,
      JSON.stringify({
        name,
        ...(avatarWords ? { avatar_words: avatarWords } : {}),
        avatar: avatarFiles[0],
        avatars: avatarFiles,
        brolls: brollFiles,
        broll_cues: brollCues,
        lang,
        fx,
        roteiro,
        formato,
        resolucao,
        limite_mb: limiteMb,
        cta,
        aviso,
        // Com gráficos, o Python entrega um mestre de 1080 e a entrega do Sávio (720/1080, até 30 MB) vem depois deles.
        graficos_depois: graphics.length > 0,
        out: path.join(midia, outName),
        workdir: path.join(DATA_DIR, "tmp", gen.id),
        fontsdir: FONTS,
        timeline_out: timelineFile,
        entrega_out: entregaFile,
      }),
    );

    launch(gen.id, SCRIPT, jobFile, outName, "Montagem", copias, async (line) => {
      if (pedidos.length && !graphics.length) line(`gráficos animados ficaram de fora: eles são desenhados só para o 9:16 (este é ${formato})`);
      // Gráficos animados (opcionais) depois da edição; se falharem, o vídeo sai sem eles e o log explica.
      if (!graphics.length) return;
      try {
        await applyGraphics({ video: path.join(midia, outName), timelineFile, graphics, workdir: path.join(DATA_DIR, "tmp", `${gen.id}-gfx`), log: line });
      } catch (err) {
        line(`gráficos animados falharam (${err instanceof Error ? err.message.slice(0, 200) : "erro"}); vídeo entregue sem eles`);
      }
      // Entrega no padrão do Sávio depois dos gráficos (resolução e limite de 30 MB).
      await entregarDepoisDosGraficos(jobFile, line);
    });
  })().catch(async (err) => {
    running.delete(gen.id);
    soltarCopias(copias);
    await updateGeneration(gen.id, { status: "failed", error: `Montagem: ${err instanceof Error ? err.message : "erro"}` });
  });

  return gen;
}

// Entrega do Sávio (720/1080 de largura, até 30 MB) do vídeo que já recebeu os gráficos animados: roda
// `montagem.py --finalizar` no mesmo arquivo. Se falhar, o mestre de 1080 fica como está e o registro explica.
function entregarDepoisDosGraficos(jobFile: string, line: (m: string) => void): Promise<void> {
  const python = process.env.PYTHON_BIN || "python";
  const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
  return new Promise((resolve) => {
    execFile(python, ["-W", "ignore", SCRIPT, "--finalizar", jobFile], { windowsHide: true, timeout: 30 * 60_000, maxBuffer: 10 * 1024 * 1024, env }, (err, stdout) => {
      const saida = String(stdout ?? "");
      for (const l of saida.split("\n").filter((x) => x.trim() && !x.includes("DONE"))) line(l.replace(/^\[[\d:]+\]\s*/, ""));
      if (err) line(`a entrega final falhou (${(saida.match(/ERROR (.+)/)?.[1] ?? err.message).slice(0, 200)}); o vídeo fica em 1080`);
      resolve();
    });
  });
}

// Roda um script Python da edição em segundo plano: o log fica em .data/montagem/<id>.log (na raiz) e o status da geração é
// atualizado ao terminar. `after` roda depois de um DONE (ex.: gráficos animados), antes de marcar como pronta.
// Pronto, o vídeo segue para o Google Drive (features/drive), também em segundo plano. As `copias` seguras são
// soltas quando o processo termina, com sucesso ou com erro. Com erro, o que o script deixou pela metade na pasta de
// mídia sai na hora (regra do dono: vídeo fora do Drive não fica).
function launch(
  id: string,
  script: string,
  jobFile: string,
  outName: string,
  label: string,
  copias: string[],
  after?: (line: (m: string) => void) => Promise<void>,
) {
  const log: string[] = [];
  // O fim do processo grava na organização que pediu a edição (a mesma da geração), mesmo horas depois.
  const org = organizacaoDoContexto();
  const naOrganizacao = <T,>(fn: () => T): T => (org ? comOrganizacao(org, fn) : fn());
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
  // Intermediários que o script e os gráficos gravam ao lado do vídeo (".gfx.mp4", ".tmp.mp4" da entrega).
  const tirarIntermediarios = () => Promise.all([apagarDaMidia(`${outName}.gfx.mp4`), apagarDaMidia(`${outName}.tmp.mp4`)]);
  const tirarSobras = () => Promise.all([apagarDaMidia(outName), tirarIntermediarios()]);
  child.on("error", (err) => {
    running.delete(id);
    soltarCopias(copias);
    void naOrganizacao(async () => {
      await tirarSobras();
      await updateGeneration(id, { status: "failed", error: `Não consegui rodar o Python (${err.message}). Defina PYTHON_BIN no .env.local.` });
    });
  });
  child.on("close", (code) => naOrganizacao(async () => {
    // O Python já não lê as cópias (os gráficos do `after` usam só o vídeo novo).
    soltarCopias(copias);
    const text = log.join("");
    if (code === 0 && text.includes("DONE")) {
      if (after) await after((m: string) => collect(Buffer.from(`[${new Date().toLocaleTimeString("pt-BR")}] ${m}\n`))).catch(() => undefined);
      await tirarIntermediarios();
      running.delete(id);
      // Apagada durante a edição: o vídeo novo não tem dono e sai na hora.
      await concluirComArquivo(id, { file: outName });
    } else {
      running.delete(id);
      await tirarSobras();
      const missing = /No module named '(torch|cv2)'/.exec(text)?.[1];
      const err = missing
        ? `falta instalar ${missing === "cv2" ? "o OpenCV" : "o PyTorch"} neste servidor (pip install torch opencv-python-headless); por enquanto isso roda no PC`
        : (text.match(/ERROR (.+)/)?.[1] ?? text.trim().split("\n").slice(-2).join(" "));
      await updateGeneration(id, { status: "failed", error: `${label}: ${err.slice(0, 300) || `saiu com código ${code}`}` });
    }
  }));
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
  await exigirDriveParaVideo();
  const ids = [...new Set((req.clipIds ?? []).map(String).filter(Boolean))].slice(0, MAX_BEAT_CLIPS);
  if (!ids.length) throw new InputError("Escolha pelo menos um vídeo de cena.");
  const clips = await Promise.all(ids.map((id, i) => videoFile(id, `A cena ${i + 1}`)));
  const copias: string[] = [];
  let song: string | null = null;
  if (req.songId) {
    const m = await getGeneration(String(req.songId));
    if (!m?.file || m.kind !== "audio") throw new InputError("A música precisa ser um áudio pronto do hub.");
    song = await copiaSegura(m.file, copias);
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
  const midia = await pastaDeMidia();
  await mkdir(midia, { recursive: true });
  const outName = `${randomUUID()}.mp4`;
  const jobFile = path.join(LOG_DIR, `${gen.id}.json`);
  // Em segundo plano: uma cena que está só no Google Drive é baixada antes, e o pedido não espera o download.
  running.add(gen.id);
  void (async () => {
    const clipFiles = await Promise.all(clips.map((c) => copiaSegura(c.file, copias)));
    await writeFile(
      jobFile,
      JSON.stringify({
        name,
        clips: clipFiles,
        song,
        song_start: Math.max(0, Number(req.songStart) || 0),
        dur: duration,
        bpm,
        words,
        cta,
        cta_clip: clipIdx(req.cta?.clip),
        accent,
        out: path.join(midia, outName),
        workdir: path.join(DATA_DIR, "tmp", gen.id),
        fontsdir: FONTS,
      }),
    );
    launch(gen.id, BEAT_SCRIPT, jobFile, outName, "Edição na batida", copias);
  })().catch(async (err) => {
    running.delete(gen.id);
    soltarCopias(copias);
    await updateGeneration(gen.id, { status: "failed", error: `Edição na batida: ${err instanceof Error ? err.message : "erro"}` });
  });
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
  await exigirDriveParaVideo();
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
    params: { formato: "sem-legenda", origem: g.id, regiao: region, modo: mode, duracao: Math.round(Number(g.params.duration) || 0) || null },
  });
  await mkdir(LOG_DIR, { recursive: true });
  const midia = await pastaDeMidia();
  await mkdir(midia, { recursive: true });
  const outName = `${randomUUID()}.mp4`;
  const jobFile = path.join(LOG_DIR, `${gen.id}.json`);
  // Em segundo plano: um vídeo que está só no Google Drive é baixado antes, e o pedido não espera o download.
  running.add(gen.id);
  const copias: string[] = [];
  void (async () => {
    const input = await copiaSegura(file, copias);
    // Duração medida no arquivo, para a previsão de tempo da barra de progresso.
    const duracao = Math.round(await seconds(input)) || null;
    if (duracao && duracao !== gen.params.duracao) await updateGeneration(gen.id, { params: { ...gen.params, duracao } });
    await writeFile(
      jobFile,
      JSON.stringify({ input, out: path.join(midia, outName), workdir: path.join(DATA_DIR, "tmp", gen.id), model: LAMA_MODEL, region, mode }),
    );
    launch(gen.id, CAPTION_SCRIPT, jobFile, outName, "Remover legenda", copias);
  })().catch(async (err) => {
    running.delete(gen.id);
    soltarCopias(copias);
    await updateGeneration(gen.id, { status: "failed", error: `Remover legenda: ${err instanceof Error ? err.message : "erro"}` });
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
