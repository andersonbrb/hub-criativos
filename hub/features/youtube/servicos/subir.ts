import "server-only";

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";

import type { Visibilidade } from "@/features/youtube/contrato";
import {
  apiDesligada,
  API_YOUTUBE,
  chamarGoogle,
  ErroDoYoutube,
  esquecerTokenDeAcesso,
  lerErroDoGoogle,
  tokenDeAcesso,
  YoutubeNaoConectado,
  type ErroDoGoogle,
} from "@/features/youtube/servicos/conta";

// Conversa com a API de envio do YouTube (por fetch, com o token de conta.ts): o vídeo em pedaços (upload
// "resumable", como no Drive), a miniatura e a conferência de como o YouTube processou o vídeo.
// Nada aqui carrega o vídeo inteiro na memória.

const UPLOAD_VIDEO = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const UPLOAD_MINIATURA = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

const MiB = 1024 * 1024;
// O Google exige pedaços múltiplos de 256 KiB (menos o último).
export const MULTIPLO_DO_PEDACO = 256 * 1024;
const TAMANHO_DO_PEDACO = 8 * MiB;
const MAX_TENTATIVAS = 5;
// Categoria "Pessoas e blogs", a padrão do YouTube Studio.
const CATEGORIA_PADRAO = "22";

export type DadosDoVideo = {
  titulo: string;
  descricao: string;
  visibilidade: Visibilidade;
  paraCriancas: boolean;
};

// O que o YouTube devolve ao terminar o envio (só o que o hub usa).
export type VideoNoYoutube = {
  id: string;
  status?: { privacyStatus?: string; uploadStatus?: string; rejectionReason?: string; failureReason?: string };
};

// ---------------------------------------------------------------------------------------------------------------
// Erros do YouTube em linguagem simples

export function traduzirErro(e: ErroDoGoogle, acao = "enviar o vídeo"): string {
  if (apiDesligada(e)) return "A API do YouTube não está ativada no projeto do Google Cloud do hub. Ative a YouTube Data API v3 e use Tentar de novo.";
  if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded/.test(e.motivo))
    return "Acabou a cota diária de envios do hub ao YouTube (é do hub inteiro, somando todas as organizações). Use Tentar de novo depois das 5h da manhã (Brasília), quando o YouTube libera a cota.";
  if (/uploadLimitExceeded/.test(e.motivo)) return "O canal chegou ao limite de envios do YouTube nas últimas 24 horas. Use Tentar de novo amanhã.";
  if (/youtubeSignupRequired|channelNotFound/.test(e.motivo))
    return "A conta conectada não tem canal no YouTube. Conecte de novo em Integrações → YouTube, escolhendo a conta do canal.";
  if (/invalidTitle/.test(e.motivo)) return "O YouTube não aceitou o título (até 100 caracteres, sem os sinais < e >).";
  if (/invalidDescription/.test(e.motivo)) return "O YouTube não aceitou a descrição (até 5.000 caracteres, sem os sinais < e >).";
  if (e.status === 401) return new YoutubeNaoConectado().message;
  if (e.status === 403 && /insufficientPermissions|forbidden|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/i.test(e.motivo))
    return "O hub não tem permissão de enviar vídeos nesse canal. Conecte o YouTube de novo em Integrações e deixe marcadas as permissões do YouTube.";
  if (e.status === 400) return `O YouTube recusou os dados do vídeo${e.mensagem ? `: ${e.mensagem}` : ""}.`;
  return `O YouTube não deixou ${acao} agora (código ${e.status}${e.motivo ? `, ${e.motivo}` : ""}). Use Tentar de novo.`;
}

// Por que o YouTube recusou o vídeo depois de recebê-lo (videos.list → status).
export function traduzirRecusa(status: NonNullable<VideoNoYoutube["status"]>): string | null {
  if (status.uploadStatus === "rejected") {
    const motivos: Record<string, string> = {
      duplicate: "O YouTube recusou o vídeo: ele já existe no canal (envio repetido).",
      length:
        "O YouTube recusou o vídeo: passa do tempo máximo do canal. Canais sem verificação por telefone aceitam até 15 minutos (youtube.com/verify).",
      copyright: "O YouTube recusou o vídeo por direitos autorais.",
      claim: "O YouTube recusou o vídeo por direitos autorais.",
      trademark: "O YouTube recusou o vídeo por uso de marca registrada.",
      legal: "O YouTube recusou o vídeo por motivo legal.",
      inappropriate: "O YouTube recusou o vídeo por conteúdo impróprio.",
      termsOfUse: "O YouTube recusou o vídeo por violar as regras da plataforma.",
      uploaderAccountClosed: "O YouTube recusou o vídeo: o canal está encerrado.",
      uploaderAccountSuspended: "O YouTube recusou o vídeo: o canal está suspenso.",
    };
    return motivos[status.rejectionReason ?? ""] ?? "O YouTube recusou o vídeo depois de recebê-lo. Veja o motivo no YouTube Studio.";
  }
  if (status.uploadStatus === "failed") {
    if (status.failureReason === "uploadAborted") return "O envio para o YouTube foi interrompido. Use Tentar de novo.";
    return "O YouTube não conseguiu processar o arquivo do vídeo (formato inválido ou arquivo corrompido).";
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Chamadas autenticadas

// Chama o YouTube com o token do canal; num 401, renova o token uma vez e repete.
async function comToken(fazer: (token: string) => Promise<Response>): Promise<Response> {
  const token = await tokenDeAcesso();
  const res = await fazer(token);
  if (res.status !== 401) return res;
  await res.body?.cancel().catch(() => undefined);
  await esquecerTokenDeAcesso(token);
  return fazer(await tokenDeAcesso());
}

const retentavel = (status: number) => status === 408 || status === 429 || status >= 500;

function esperar(tentativa: number, signal?: AbortSignal): Promise<void> {
  const ms = Math.min(30_000, 1000 * 2 ** (tentativa - 1)) + Math.floor(Math.random() * 500);
  return new Promise((resolver, falhar) => {
    const t = setTimeout(resolver, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        falhar(signal.reason);
      },
      { once: true },
    );
  });
}

const tipoDoVideo = (arquivo: string) =>
  ({ mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska" })[arquivo.split(".").pop()?.toLowerCase() ?? ""] ??
  "application/octet-stream";

// ---------------------------------------------------------------------------------------------------------------
// Envio do vídeo

export type Andamento = {
  // Sessão de envio já aberta (de uma tentativa anterior): o envio continua dela.
  sessao: string | null;
  // Avisa a sessão nova (para guardar) e o progresso (0 a 100).
  aoAbrirSessao: (sessao: string) => Promise<void>;
  aoAvancar: (pct: number) => Promise<void>;
  signal?: AbortSignal;
  tamanhoDoPedaco?: number;
};

export async function subirVideo(caminho: string, total: number, dados: DadosDoVideo, andamento: Andamento): Promise<VideoNoYoutube> {
  const pedaco = andamento.tamanhoDoPedaco ?? TAMANHO_DO_PEDACO;
  if (pedaco % MULTIPLO_DO_PEDACO !== 0) throw new Error("O pedaço do envio ao YouTube precisa ser múltiplo de 256 KiB.");
  const { signal } = andamento;

  let sessao = andamento.sessao;
  let enviado = 0;
  // Sessão de uma tentativa anterior: pergunta antes até onde chegou (pode até já ter terminado).
  let perguntar = Boolean(sessao);
  let reaberturas = 0;
  let falhas = 0;
  let ultimoPct = -1;

  for (;;) {
    signal?.throwIfAborted();
    if (!sessao) {
      sessao = await abrirSessao(caminho, total, dados, signal);
      await andamento.aoAbrirSessao(sessao);
      enviado = 0;
      perguntar = false;
    }
    let resposta: Response | null;
    try {
      const s = sessao;
      resposta = await comToken((token) =>
        perguntar ? perguntarAteOnde(s, total, token, signal) : mandarPedaco(s, caminho, enviado, Math.min(enviado + pedaco, total), total, token, signal),
      );
    } catch (err) {
      // Só a rede (ou o Google instável) é passageira; canal desconectado, cliente recusado e erro do disco param.
      if (signal?.aborted || !(err instanceof ErroDoYoutube && err.passageira)) throw err;
      resposta = null; // pergunta até onde chegou e continua
    }

    if (resposta && (resposta.status === 200 || resposta.status === 201)) {
      await andamento.aoAvancar(100);
      return (await resposta.json()) as VideoNoYoutube;
    }
    if (resposta?.status === 308) {
      const confirmado = bytesConfirmados(resposta);
      await resposta.body?.cancel().catch(() => undefined);
      const avancou = confirmado > enviado;
      const eraPergunta = perguntar;
      enviado = confirmado;
      perguntar = false;
      if (avancou) falhas = 0;
      const pct = Math.min(99, Math.floor((enviado / Math.max(total, 1)) * 100));
      if (pct !== ultimoPct) {
        ultimoPct = pct;
        await andamento.aoAvancar(pct);
      }
      if (avancou || eraPergunta) continue;
    } else if (resposta && (resposta.status === 404 || resposta.status === 410)) {
      // A sessão venceu (dura cerca de uma semana) ou o Google a descartou: abre outra e manda do começo, uma vez.
      await resposta.body?.cancel().catch(() => undefined);
      if (reaberturas++ >= 1) throw new ErroDoYoutube("O envio para o YouTube venceu no meio do caminho. Use Tentar de novo.", resposta.status);
      sessao = null;
      continue;
    } else if (resposta) {
      if (!retentavel(resposta.status)) throw new ErroDoYoutube(traduzirErro(await lerErroDoGoogle(resposta)), resposta.status);
      await resposta.body?.cancel().catch(() => undefined);
      perguntar = true;
    } else {
      perguntar = true;
    }
    falhas += 1;
    if (falhas > MAX_TENTATIVAS) throw new ErroDoYoutube("O envio para o YouTube falhou várias vezes seguidas. Confira a internet e use Tentar de novo.", resposta?.status ?? 0);
    await esperar(falhas, signal);
  }
}

async function abrirSessao(caminho: string, total: number, dados: DadosDoVideo, signal?: AbortSignal): Promise<string> {
  const corpo = JSON.stringify({
    snippet: { title: dados.titulo, description: dados.descricao, categoryId: CATEGORIA_PADRAO },
    status: { privacyStatus: dados.visibilidade, selfDeclaredMadeForKids: dados.paraCriancas, embeddable: true },
  });
  for (let falhas = 1; ; falhas++) {
    signal?.throwIfAborted();
    let res: Response | null = null;
    try {
      res = await comToken((token) =>
        chamarGoogle(UPLOAD_VIDEO, {
          method: "POST",
          signal,
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json; charset=UTF-8",
            "X-Upload-Content-Length": String(total),
            "X-Upload-Content-Type": tipoDoVideo(caminho),
          },
          body: corpo,
        }),
      );
    } catch (err) {
      if (signal?.aborted || !(err instanceof ErroDoYoutube && err.passageira)) throw err;
    }
    if (res?.ok) {
      const sessao = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!sessao) throw new ErroDoYoutube("O YouTube não abriu o envio do vídeo. Use Tentar de novo.", res.status);
      return sessao;
    }
    if (res && !retentavel(res.status)) throw new ErroDoYoutube(traduzirErro(await lerErroDoGoogle(res)), res.status);
    await res?.body?.cancel().catch(() => undefined);
    if (falhas > MAX_TENTATIVAS) throw new ErroDoYoutube("O YouTube está instável agora e não deu para começar o envio. Use Tentar de novo em instantes.", res?.status ?? 0);
    await esperar(falhas, signal);
  }
}

async function mandarPedaco(sessao: string, caminho: string, inicio: number, fim: number, total: number, token: string, signal?: AbortSignal) {
  const corpo = await lerTrecho(caminho, inicio, fim);
  const faixa = fim > inicio ? `bytes ${inicio}-${fim - 1}/${total}` : `bytes */${total}`;
  return chamarGoogle(sessao, { method: "PUT", signal, headers: { authorization: `Bearer ${token}`, "Content-Range": faixa }, body: corpo }, 5 * 60_000);
}

const perguntarAteOnde = (sessao: string, total: number, token: string, signal?: AbortSignal) =>
  chamarGoogle(sessao, { method: "PUT", signal, headers: { authorization: `Bearer ${token}`, "Content-Range": `bytes */${total}` } });

function bytesConfirmados(resposta: Response): number {
  const faixa = resposta.headers.get("range")?.match(/bytes=0-(\d+)/);
  return faixa ? Number(faixa[1]) + 1 : 0;
}

async function lerTrecho(caminho: string, inicio: number, fim: number): Promise<Uint8Array<ArrayBuffer>> {
  const tamanho = fim - inicio;
  const corpo = new Uint8Array(tamanho);
  if (tamanho === 0) return corpo;
  let lidos = 0;
  for await (const parte of createReadStream(caminho, { start: inicio, end: fim - 1 }) as AsyncIterable<Buffer>) {
    corpo.set(parte, lidos);
    lidos += parte.length;
  }
  if (lidos !== tamanho) throw new ErroDoYoutube("O arquivo do vídeo mudou no disco durante o envio. Use Tentar de novo.");
  return corpo;
}

// ---------------------------------------------------------------------------------------------------------------
// Miniatura

// Aplica a miniatura. Devolve null se deu certo, ou o aviso (o vídeo já está no canal: a miniatura é um extra).
export async function aplicarMiniatura(videoId: string, caminho: string, tipo: string): Promise<string | null> {
  let corpo: Buffer;
  try {
    corpo = await readFile(caminho);
  } catch {
    return "A miniatura não foi aplicada: a imagem não estava mais no hub. O vídeo ficou com a miniatura automática do YouTube.";
  }
  try {
    const url = `${UPLOAD_MINIATURA}?videoId=${encodeURIComponent(videoId)}&uploadType=media`;
    const res = await comToken((token) =>
      chamarGoogle(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": tipo }, body: new Uint8Array(corpo) }, 2 * 60_000),
    );
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const erro = await lerErroDoGoogle(res);
    if (res.status === 403)
      return "A miniatura não foi aplicada: o YouTube só aceita miniatura própria em canal verificado por telefone (youtube.com/verify). O vídeo ficou com a miniatura automática.";
    return `A miniatura não foi aplicada (${traduzirErro(erro, "trocar a miniatura")}) O vídeo ficou com a miniatura automática.`;
  } catch (err) {
    return `A miniatura não foi aplicada (${err instanceof Error ? err.message : "erro"}). O vídeo ficou com a miniatura automática.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Conferência depois do envio

// Situação dos vídeos no YouTube (até 50 por chamada). Vídeo que sumiu do canal não volta na lista.
export async function situacaoNoYoutube(ids: string[]): Promise<Map<string, NonNullable<VideoNoYoutube["status"]>>> {
  const mapa = new Map<string, NonNullable<VideoNoYoutube["status"]>>();
  if (!ids.length) return mapa;
  const url = `${API_YOUTUBE}/videos?part=status&id=${ids.slice(0, 50).map(encodeURIComponent).join(",")}`;
  const res = await comToken((token) => chamarGoogle(url, { headers: { authorization: `Bearer ${token}` } }));
  if (!res.ok) throw new ErroDoYoutube(traduzirErro(await lerErroDoGoogle(res), "conferir o vídeo"), res.status);
  const { items } = (await res.json().catch(() => ({}))) as { items?: VideoNoYoutube[] };
  for (const v of items ?? []) if (v.id && v.status) mapa.set(v.id, v.status);
  return mapa;
}
