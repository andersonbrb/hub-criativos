import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { exigirDriveParaVideo } from "@/features/drive/servicos/videos";
import { entrada, MARCA_DA_SAIDA, pasta } from "@/features/edicoes/contrato";
import { edicaoRodando, iniciarEdicao, logPath } from "@/features/edicoes/servicos/rodar";
import type { Generation } from "@/lib/generations";
import { InputError } from "@/lib/server/http";
import { sanitizeGraphics, type GraphicRequest } from "@/lib/server/motion";
import { createGeneration, getGeneration, updateGeneration } from "@/lib/server/store";

// Edição final (playbook infoproduto-edicao-video e contexto do Sávio): Python + faster-whisper + ffmpeg
// (scripts/montagem.py) e a camada do Remotion. Não gasta créditos de nenhuma ferramenta. Aqui o pedido vira um
// trabalho; quem roda é o servidor de edições (features/edicoes, pedido do dono de 28/10/2026: o site não fica lento
// enquanto alguém edita), ou o próprio site quando ele não está configurado (o PC, por exemplo).

export const LANGS = ["es", "pt", "fr", "en"] as const;

export { logPath };

// A edição desta geração está em andamento neste processo (a faxina não apaga a pasta de trabalho dela).
export const montagemRodando = edicaoRodando;

// Nome do arquivo de entrada no trabalho: o mesmo tipo do arquivo do hub (o script e o ffmpeg olham a extensão).
const nomeDaEntrada = (prefixo: string, file: string) => `${prefixo}${path.extname(file).toLowerCase() || ".mp4"}`;

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
  // Antigo: ignorado. A legenda sai do jeito que foi falada, nunca toda em caixa alta (decisão do Vinícius, 20/10/2026).
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
  // Sem avatar: a narração (áudio do hub) vira a fala e os b-rolls cobrem o vídeo inteiro (montarBaseDaNarracao).
  // Um áudio em avatarId/avatarIds também conta como narração.
  narracaoId?: string;
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

// Só o que é válido e diferente do padrão do script. A música volta à parte (`musica`: o arquivo do hub), porque vai
// junto com o trabalho como entrada.
async function cleanFx(fx: MontageFx | undefined) {
  if (!fx || typeof fx !== "object") return { fx: {} as Record<string, unknown>, labels: [] as string[], musica: null as string | null };
  const out: Record<string, unknown> = {};
  const labels: string[] = [];
  const set = (key: string, value: unknown, label: string) => {
    out[key] = value;
    labels.push(label);
  };
  if (fx.estilo === "sb") set("estilo", "sb", "legenda sb (Anton)");
  if (fx.legenda === "palavra") set("legenda", "palavra", "legenda palavra a palavra");
  if (fx.zoom_cortes === false) set("zoom_cortes", false, "sem troca de enquadramento");
  if (fx.transicao === "dissolve" || fx.transicao === "zoom" || fx.transicao === "slide") set("transicao", fx.transicao, `transição ${fx.transicao}`);
  if (fx.whoosh === true) set("whoosh", true, "whoosh nas entradas de b-roll");
  if (fx.cor === "quente" || fx.cor === "fria" || fx.cor === "vivo") set("cor", fx.cor, `cor ${fx.cor}`);
  if (fx.barra_progresso === true) set("barra_progresso", true, "barra de progresso");
  let musica: string | null = null;
  if (fx.musicId) {
    const m = await getGeneration(String(fx.musicId));
    if (!m?.file || m.kind !== "audio") throw new InputError("A música precisa ser um áudio pronto do hub.");
    musica = m.file;
    labels.push("música de fundo (-32 LUFS sob a fala)");
  }
  return { fx: out, labels, musica };
}

// Tags de emoção do ElevenLabs ([excited]…) não são faladas: saem do roteiro da legenda.
const semTags = (t: string) => t.replace(/\[[^\]\n]{1,40}\]/g, " ").replace(/\s+/g, " ").trim();

// Áudio pronto do hub (narração da edição sem avatar).
async function audioFile(id: string) {
  const g = await getGeneration(id);
  if (!g || g.kind !== "audio" || g.status !== "done" || !g.file) throw new InputError("A narração precisa ser um áudio pronto do hub.");
  return { g, file: g.file };
}

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
  const pedidosDeAvatar = [...new Set((req.avatarIds?.length ? req.avatarIds : [req.avatarId ?? ""]).map(String).filter(Boolean))].slice(0, MAX_AVATARS);
  // Um áudio no lugar do avatar é a narração (edição sem avatar).
  const primeiro = !req.narracaoId && pedidosDeAvatar.length === 1 ? await getGeneration(pedidosDeAvatar[0]) : null;
  const narracaoId = String(req.narracaoId ?? "").trim() || (primeiro?.kind === "audio" ? primeiro.id : "");
  const narracao = narracaoId ? await audioFile(narracaoId) : null;
  const avatarIds = narracao ? [] : pedidosDeAvatar;
  if (!narracao && !avatarIds.length) throw new InputError("Escolha pelo menos um vídeo do avatar ou uma narração (áudio) com b-rolls.");
  const avatars = await Promise.all(avatarIds.map((id, i) => videoFile(id, avatarIds.length > 1 ? `O avatar ${i + 1}` : "O avatar")));
  const fala = narracao ?? avatars[0];
  const pairs = (req.brollIds ?? [])
    .map((id, i) => ({ id: String(id ?? ""), cue: String(req.brollCues?.[i] ?? "").trim().slice(0, 60) }))
    .filter((p) => p.id)
    .slice(0, MAX_BROLLS);
  const brollIds = pairs.map((p) => p.id);
  const brollCues = pairs.map((p) => p.cue);
  const brolls = await Promise.all(brollIds.map((id, i) => videoFile(id, `O b-roll ${i + 1}`)));
  if (narracao && !brolls.length) throw new InputError("Sem avatar, a narração entra sobre os b-rolls: escolha pelo menos um b-roll.");
  const lang = LANGS.includes(req.lang as (typeof LANGS)[number]) ? (req.lang as string) : "es";
  // Nome no padrão do Sávio ("AD 01 - OFERTA-FORMATO-VOZ/IDIOMA-VARIAÇÃO"): vira o nome do arquivo e do anúncio.
  const nomeDado = String(req.name ?? "").trim().replace(/[^\w\- ]+/g, "_").replace(/\s+/g, " ").slice(0, 80);
  const name = nomeDado || "AD";
  const { fx, labels, musica } = await cleanFx(req.fx);
  const formato = FORMATOS.includes(req.formato as (typeof FORMATOS)[number]) ? (req.formato as string) : "9:16";
  const resolucao = RESOLUCOES.includes(String(req.resolucao) as (typeof RESOLUCOES)[number]) ? String(req.resolucao) : "auto";
  const limiteMb = Math.min(500, Math.max(5, Number(req.limiteMb) || 30));
  const roteiroPedido = semTags(String(req.roteiro ?? "")).slice(0, 20_000);
  const roteiro = roteiroPedido || (narracao ? (narracao.g.tool === "elevenlabs" ? semTags(narracao.g.prompt) || null : null) : roteiroDosAvatares(avatars));
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
    prompt: `Edição ${name}: ${fala.g.prompt}${avatars.length > 1 ? ` (+${avatars.length - 1})` : ""}${narracao ? " (narração sobre b-rolls, sem avatar)" : ""}`,
    params: {
      name,
      lang,
      avatarId: avatars[0]?.g.id ?? null,
      avatarIds: avatarIds.join(","),
      narracaoId: narracao?.g.id ?? null,
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

  // Entradas do trabalho: cada vídeo e áudio do hub com um nome próprio (o arquivo vem do Drive ou da mídia na hora).
  const arquivos: Record<string, string> = {};
  const ref = (nome: string, file: string) => {
    arquivos[nome] = file;
    return entrada(nome);
  };
  const avatarRefs = avatars.map((a, i) => ref(nomeDaEntrada(`avatar${i}`, a.file), a.file));
  const brollRefs = brolls.map((b, i) => ref(nomeDaEntrada(`broll${i}`, b.file), b.file));
  if (musica) fx.musica = ref(nomeDaEntrada("musica", musica), musica);
  const job = {
    name,
    avatar: avatarRefs[0] ?? null,
    avatars: avatarRefs,
    brolls: brollRefs,
    broll_cues: brollCues,
    lang,
    fx,
    roteiro,
    formato,
    resolucao,
    limite_mb: limiteMb,
    cta,
    aviso,
    // O Python entrega um mestre limpo de 1080 e os dados da camada visual; o Remotion desenha a camada (legenda,
    // aviso, barra, setas e gráficos) e a entrega do Sávio (720/1080, até 30 MB) vem depois.
    graficos_depois: true,
    camada_out: pasta("camada.json"),
    out: MARCA_DA_SAIDA,
    workdir: pasta("trabalho"),
    timeline_out: pasta("timeline.json"),
    entrega_out: pasta("entrega.json"),
  };
  // Sem avatar, quem roda monta a base (b-rolls cobrindo a narração) antes do Python.
  const narracaoDoJob = narracao ? { audio: ref(nomeDaEntrada("narracao", narracao.file), narracao.file), brolls: brollRefs, cues: brollCues } : null;
  await iniciarEdicao({
    id: gen.id,
    rotulo: "Montagem",
    outName: `${randomUUID()}.mp4`,
    trabalho: {
      tipo: "montagem",
      dados: { job, narracao: narracaoDoJob, graficos: graphics, foraDoFormato: pedidos.length && !graphics.length ? formato : null },
    },
    arquivos,
    // Primeiro as palavras com tempo da fala ORIGINAL de cada vídeo do avatar (transcrição em cache ou Whisper, como no
    // contexto do Sávio). Sem elas, o script transcreve sozinho.
    palavrasDe: narracao ? [narracao.g.id] : avatarIds,
  });
  return gen;
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
  let song: string | null = null;
  if (req.songId) {
    const m = await getGeneration(String(req.songId));
    if (!m?.file || m.kind !== "audio") throw new InputError("A música precisa ser um áudio pronto do hub.");
    song = m.file;
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

  const arquivos: Record<string, string> = {};
  const ref = (nome: string, file: string) => {
    arquivos[nome] = file;
    return entrada(nome);
  };
  await iniciarEdicao({
    id: gen.id,
    rotulo: "Edição na batida",
    outName: `${randomUUID()}.mp4`,
    trabalho: {
      tipo: "batida",
      dados: {
        // As palavras gigantes saem pelo Remotion, por cima do vídeo já com os efeitos; até 30 MB (contexto do Sávio).
        job: {
          name,
          clips: clips.map((c, i) => ref(nomeDaEntrada(`cena${i}`, c.file), c.file)),
          song: song ? ref(nomeDaEntrada("musica", song), song) : null,
          song_start: Math.max(0, Number(req.songStart) || 0),
          dur: duration,
          bpm,
          words,
          cta,
          cta_clip: clipIdx(req.cta?.clip),
          accent,
          out: MARCA_DA_SAIDA,
          workdir: pasta("trabalho"),
          camada_out: pasta("camada.json"),
        },
      },
    },
    arquivos,
  });
  return gen;
}

// ---------- Remover legenda (scripts/remover_legenda.py, LaMa) ----------
// Tira a legenda queimada de um vídeo: acha o texto em cada quadro e preenche a área com o LaMa (inpainting).
// region: onde procurar (baixo, meio, topo, tudo). mode: "auto" (só as letras) ou "faixa" (a faixa inteira do texto).
export const CAPTION_REGIONS = ["baixo", "meio", "topo", "tudo"] as const;
export type CaptionRemovalRequest = { videoId: string; region?: (typeof CAPTION_REGIONS)[number]; mode?: "auto" | "faixa"; name?: string };

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
  const nome = nomeDaEntrada("video", file);
  await iniciarEdicao({
    id: gen.id,
    rotulo: "Remover legenda",
    outName: `${randomUUID()}.mp4`,
    trabalho: {
      tipo: "sem-legenda",
      dados: { job: { input: entrada(nome), out: MARCA_DA_SAIDA, workdir: pasta("trabalho"), region, mode } },
    },
    arquivos: { [nome]: file },
    // Duração medida no arquivo, para a previsão de tempo da barra de progresso.
    duracaoDe: nome,
  });
  return gen;
}

export async function readLog(id: string): Promise<string> {
  return readFile(logPath(id), "utf8").catch(() => "");
}

// Status atual. Num reinício a edição continua sozinha (features/edicoes/servicos/rodar.ts, na subida); se mesmo
// assim ela não está em andamento neste processo, morreu junto e é marcada como interrompida.
export async function montageStatus(gen: Generation): Promise<Generation> {
  if (gen.status === "running" && !edicaoRodando(gen.id)) {
    return (await updateGeneration(gen.id, { status: "failed", error: "Montagem interrompida (o servidor reiniciou). Rode de novo." })) ?? gen;
  }
  return gen;
}
