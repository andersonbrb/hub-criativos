import "server-only";

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as ReadableStreamDoNode } from "node:stream/web";

import type { ArquivoDrive, PastaDoDrive, Trecho } from "@/features/drive/contrato";
import {
  API_DRIVE,
  chamarDrive,
  descartar,
  ErroDoDrive,
  erroDoDrive,
  esquecerPastas,
  pastaDoDrive,
  UPLOAD_DRIVE,
} from "@/features/drive/servicos/pastas";
import { DATA_DIR } from "@/lib/server/store";

// Arquivos no Drive (API v3 por fetch, com o token de conta.ts). Contrato estável: as assinaturas não mudam.
// Os vídeos chegam a 2 GB: nada aqui carrega um arquivo inteiro na memória (envio em pedaços, download por stream).

export { ErroDoDrive } from "@/features/drive/servicos/pastas";

// O arquivo não existe mais no Drive (apagado de vez) ou esta conta não o enxerga. Quem chama pode tratar à parte,
// por exemplo devolvendo 404 na rota de mídia.
export class ArquivoForaDoDrive extends ErroDoDrive {
  constructor(mensagem = "Esse vídeo não está mais no Drive.") {
    super(mensagem, 404);
    this.name = "ArquivoForaDoDrive";
  }
}

const CAMPOS = "id,name,mimeType,size,modifiedTime,trashed";
const MiB = 1024 * 1024;
// O Google exige pedaços múltiplos de 256 KiB (menos o último).
export const MULTIPLO_DO_PEDACO = 256 * 1024;
export const TAMANHO_DO_PEDACO = 16 * MiB;
// Tentativas a mais por pedaço em erro 5xx ou de rede.
const MAX_TENTATIVAS = 5;
// Quantos arquivos o espelho confere ao mesmo tempo.
const SIMULTANEOS = 8;

// Espera entre tentativas (dobra a cada falha). Os testes encolhem para não esperar de verdade.
export const ajustes = { esperaInicialMs: 1000 };

type ArquivoDoGoogle = { id: string; name?: string; mimeType?: string; size?: string; modifiedTime?: string; trashed?: boolean };

const paraArquivo = (f: ArquivoDoGoogle): ArquivoDrive => ({
  id: f.id,
  nome: f.name ?? "",
  mimeType: f.mimeType ?? "application/octet-stream",
  tamanho: Number(f.size ?? 0),
  modificadoEm: f.modifiedTime ?? "",
  noLixo: f.trashed === true,
});

// Ids do Drive têm só letras, números, "-" e "_". Conferir evita caminho estranho na pasta temporária.
const idValido = (id: string) => /^[\w-]{1,200}$/.test(id);

function exigirId(id: string): string {
  if (!idValido(id)) throw new Error("Id de arquivo do Drive inválido.");
  return id;
}

const urlDoArquivo = (id: string, campos = CAMPOS) => `${API_DRIVE}/files/${encodeURIComponent(id)}?fields=${campos}`;
const urlDoConteudo = (id: string) => `${API_DRIVE}/files/${encodeURIComponent(id)}?alt=media`;
// Sem compressão: o Content-Length precisa ser o do arquivo, para repassar ao navegador e conferir o download.
const SEM_COMPRESSAO = { "Accept-Encoding": "identity" };
const JSON_UTF8 = { "Content-Type": "application/json; charset=UTF-8" };

const esperar = (falhas: number) =>
  new Promise((ok) => setTimeout(ok, ajustes.esperaInicialMs * 2 ** (falhas - 1) + Math.random() * (ajustes.esperaInicialMs / 2)));

// Vale tentar de novo: o Google está instável ou pediu pausa.
const retentavel = (status: number) => status >= 500 || status === 429 || status === 408;

// Faz o pedido; se a rede cair, devolve null em vez de lançar (quem chamou decide se tenta de novo).
async function semCairNaRede(pedido: () => Promise<Response>): Promise<Response | null> {
  try {
    return await pedido();
  } catch (erro) {
    if (erro instanceof ErroDoDrive && erro.status === 0) return null;
    throw erro;
  }
}

// ---------- Envio ----------

// Sobe um arquivo local (em pedaços, sem carregar inteiro na memória) para a subpasta do tipo, criando
// "Hub de Criativos/<subpasta>" se faltar. Não apaga o arquivo local: quem chamou decide.
// `tamanhoDoPedaco` (múltiplo de 256 KiB) existe para os testes; o padrão é 16 MiB.
export async function enviarArquivo(
  caminhoLocal: string,
  opcoes: { nome: string; pasta: PastaDoDrive; mimeType: string; tamanhoDoPedaco?: number },
): Promise<ArquivoDrive> {
  const pedaco = opcoes.tamanhoDoPedaco ?? TAMANHO_DO_PEDACO;
  if (!Number.isInteger(pedaco) || pedaco <= 0 || pedaco % MULTIPLO_DO_PEDACO !== 0) {
    throw new Error("O pedaço do envio ao Drive precisa ser múltiplo de 256 KiB.");
  }
  const total = await stat(caminhoLocal).then(
    (info) => info.size,
    () => {
      throw new Error(`O arquivo para guardar no Drive não existe mais no disco: ${path.basename(caminhoLocal)}.`);
    },
  );
  const pasta = await pastaDoDrive(opcoes.pasta);
  const sessao = await abrirSessao(total, pasta, opcoes);

  // Upload "resumable": cada PUT manda um pedaço com Content-Range. O Google responde 308 com o que já guardou
  // (cabeçalho Range) ou 200/201 com o arquivo pronto. Depois de uma falha, pergunta até onde chegou antes de
  // mandar de novo, para continuar de onde parou.
  let enviado = 0; // bytes que o Google confirmou
  let falhas = 0; // falhas seguidas sem avanço
  let perguntar = false;
  for (;;) {
    const resposta = await semCairNaRede(() =>
      perguntar ? perguntarAteOnde(sessao, total) : mandarPedaco(sessao, caminhoLocal, enviado, Math.min(enviado + pedaco, total), total),
    );
    if (resposta && (resposta.status === 200 || resposta.status === 201)) return paraArquivo((await resposta.json()) as ArquivoDoGoogle);
    if (resposta?.status === 308) {
      const confirmado = bytesConfirmados(resposta);
      await descartar(resposta);
      const avancou = confirmado > enviado;
      const eraPergunta = perguntar;
      enviado = confirmado;
      perguntar = false;
      if (avancou) falhas = 0;
      // Avançou, ou a pergunta respondeu de onde continuar: manda o próximo pedaço já.
      if (avancou || eraPergunta) continue;
      // 308 sem avanço depois de um pedaço: o Google não guardou nada dele. Conta como falha e manda de novo.
    } else if (resposta) {
      if (resposta.status === 404 || resposta.status === 410) {
        await descartar(resposta);
        throw new ErroDoDrive("O envio para o Google Drive venceu no meio do caminho. Tente de novo.", resposta.status);
      }
      if (!retentavel(resposta.status)) throw await erroDoDrive(resposta, "enviar o vídeo");
      await descartar(resposta);
      perguntar = true;
    } else {
      perguntar = true;
    }
    falhas += 1;
    if (falhas > MAX_TENTATIVAS) {
      throw new ErroDoDrive(
        "O envio para o Google Drive falhou várias vezes seguidas. Confira a internet e tente de novo.",
        resposta?.status ?? 0,
      );
    }
    await esperar(falhas);
  }
}

// Abre a sessão de envio e devolve o endereço dela. O `fields` daqui vale para a resposta final do envio.
async function abrirSessao(total: number, pasta: string, opcoes: { nome: string; mimeType: string }): Promise<string> {
  const url = `${UPLOAD_DRIVE}/files?uploadType=resumable&fields=${CAMPOS}`;
  const init: RequestInit = {
    method: "POST",
    headers: { ...JSON_UTF8, "X-Upload-Content-Type": opcoes.mimeType, "X-Upload-Content-Length": String(total) },
    body: JSON.stringify({ name: opcoes.nome, parents: [pasta], mimeType: opcoes.mimeType, appProperties: { hub: "1" } }),
  };
  for (let falhas = 1; ; falhas++) {
    const resposta = await semCairNaRede(() => chamarDrive(url, init));
    if (resposta?.ok) {
      const sessao = resposta.headers.get("location");
      await descartar(resposta);
      if (!sessao) throw new ErroDoDrive("O Google Drive não abriu o envio do vídeo. Tente de novo.", resposta.status);
      return sessao;
    }
    if (resposta?.status === 404) {
      // A subpasta sumiu entre a conferência e o envio: na próxima vez ela é procurada (ou criada) de novo.
      await descartar(resposta);
      esquecerPastas();
      throw new ErroDoDrive("A pasta do hub no Google Drive sumiu durante o envio. Tente de novo.", 404);
    }
    if (resposta && !retentavel(resposta.status)) throw await erroDoDrive(resposta, "enviar o vídeo");
    if (resposta) await descartar(resposta);
    if (falhas > MAX_TENTATIVAS) {
      if (resposta) throw new ErroDoDrive("O Google Drive está instável agora e não deu para enviar o vídeo. Tente de novo em instantes.", resposta.status);
      throw new ErroDoDrive("Sem conexão com o Google Drive. Confira a internet e tente de novo.", 0);
    }
    await esperar(falhas);
  }
}

// Manda os bytes [inicio, fim) do arquivo. Só esse pedaço vai para a memória (no máximo `tamanhoDoPedaco`).
async function mandarPedaco(sessao: string, caminho: string, inicio: number, fim: number, total: number): Promise<Response> {
  const corpo = await lerTrecho(caminho, inicio, fim);
  const faixa = fim > inicio ? `bytes ${inicio}-${fim - 1}/${total}` : `bytes */${total}`;
  return chamarDrive(sessao, { method: "PUT", headers: { "Content-Range": faixa }, body: corpo });
}

// Pergunta ao Google quanto da sessão já chegou (PUT vazio com "bytes */total").
const perguntarAteOnde = (sessao: string, total: number) =>
  chamarDrive(sessao, { method: "PUT", headers: { "Content-Range": `bytes */${total}` } });

// "Range: bytes=0-N" → N+1 bytes guardados. Sem o cabeçalho, nada foi guardado ainda.
function bytesConfirmados(resposta: Response): number {
  const faixa = resposta.headers.get("range")?.match(/bytes=0-(\d+)/);
  return faixa ? Number(faixa[1]) + 1 : 0;
}

async function lerTrecho(caminho: string, inicio: number, fim: number): Promise<Uint8Array<ArrayBuffer>> {
  const tamanho = fim - inicio;
  const corpo = new Uint8Array(tamanho);
  if (tamanho === 0) return corpo;
  let lidos = 0;
  try {
    for await (const parte of createReadStream(caminho, { start: inicio, end: fim - 1 }) as AsyncIterable<Buffer>) {
      corpo.set(parte, lidos);
      lidos += parte.length;
    }
  } catch (erro) {
    throw new Error("Não deu para ler o arquivo do disco durante o envio ao Drive.", { cause: erro });
  }
  if (lidos !== tamanho) throw new Error("O arquivo mudou no disco durante o envio ao Drive. Tente de novo.");
  return corpo;
}

// ---------- Tocar e baixar ----------

// Pedido de faixa que o Google entende ("bytes=0-", "bytes=100-199", "bytes=-500"). O resto é ignorado.
const faixaValida = (range: string | null) => (range && range.length <= 200 && /^bytes=[\d\s,-]+$/.test(range) ? range : null);

// Para o player e o download: repassa o Range pedido pelo navegador. O corpo é o stream do Google, sem cópia.
export async function abrirTrecho(id: string, range: string | null): Promise<Trecho> {
  exigirId(id);
  const faixa = faixaValida(range);
  const resposta = await chamarDrive(urlDoConteudo(id), { headers: { ...SEM_COMPRESSAO, ...(faixa ? { Range: faixa } : {}) } });
  if (resposta.status === 416) {
    await descartar(resposta);
    const cabecalhos: Record<string, string> = { "Accept-Ranges": "bytes" };
    const tamanho = resposta.headers.get("content-range") ?? (await metadados(id).then((f) => (f ? `bytes */${f.tamanho}` : null)).catch(() => null));
    if (tamanho) cabecalhos["Content-Range"] = tamanho;
    return { status: 416, cabecalhos, corpo: null };
  }
  if (resposta.status === 404) {
    await descartar(resposta);
    throw new ArquivoForaDoDrive();
  }
  if (!resposta.ok) throw await erroDoDrive(resposta, "abrir o vídeo");
  const cabecalhos: Record<string, string> = {
    "Content-Type": resposta.headers.get("content-type") ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  const tamanho = resposta.headers.get("content-length");
  if (tamanho) cabecalhos["Content-Length"] = tamanho;
  const parte = resposta.headers.get("content-range");
  if (parte) cabecalhos["Content-Range"] = parte;
  return { status: resposta.status === 206 ? 206 : 200, cabecalhos, corpo: resposta.body };
}

// Cópias temporárias para ffmpeg, Python e envios. Fica em .data/tmp/drive/<id>.<ext>.
export const PASTA_TEMP = path.join(DATA_DIR, "tmp", "drive");
const SEIS_HORAS = 6 * 60 * 60 * 1000;
const VINTE_GB = 20 * 1024 ** 3;
const DEZ_MINUTOS = 10 * 60 * 1000;
// Mesmo acima do limite de espaço, não apaga o que foi usado há menos de 1 hora: pode estar aberto no ffmpeg.
const CARENCIA = 60 * 60 * 1000;

// Tamanho esperado de cada cópia baixada (pelo nome do arquivo). Depois de reiniciar o servidor o mapa começa
// vazio, e tudo bem: a cópia só ganha o nome final depois de conferida (até lá ela é ".parcial").
const tamanhos = new Map<string, number>();
// Uma promessa por arquivo: dois pedidos do mesmo vídeo ao mesmo tempo esperam o mesmo download.
const baixando = new Map<string, Promise<string>>();

// Baixa para uma pasta temporária (com cache por id) e devolve o caminho local. Para ffmpeg, Python e envios.
export async function baixarParaTemp(id: string, extensao: string): Promise<string> {
  exigirId(id);
  const ext = extensao.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(ext)) throw new Error(`Extensão inválida para a cópia do Drive: "${extensao}".`);
  const nome = `${id}.${ext}`;
  const emAndamento = baixando.get(nome);
  if (emAndamento) return emAndamento;
  const promessa = (async () => {
    const destino = path.join(PASTA_TEMP, nome);
    if (await copiaCompleta(destino)) {
      // Marca o uso: a limpeza apaga o que ficou sem uso há mais de 6 horas.
      const agora = new Date();
      await utimes(destino, agora, agora).catch(() => undefined);
    } else {
      await baixar(id, destino);
    }
    return destino;
  })().finally(() => {
    baixando.delete(nome);
    agendarLimpeza();
  });
  baixando.set(nome, promessa);
  return promessa;
}

async function copiaCompleta(destino: string): Promise<boolean> {
  const info = await stat(destino).catch(() => null);
  if (!info?.isFile()) return false;
  const esperado = tamanhos.get(path.basename(destino));
  if (esperado === undefined || info.size === esperado) return true;
  await unlink(destino).catch(() => undefined);
  tamanhos.delete(path.basename(destino));
  return false;
}

async function baixar(id: string, destino: string): Promise<void> {
  await mkdir(PASTA_TEMP, { recursive: true });
  const resposta = await chamarDrive(urlDoConteudo(id), { headers: SEM_COMPRESSAO });
  if (resposta.status === 404) {
    await descartar(resposta);
    throw new ArquivoForaDoDrive();
  }
  if (!resposta.ok || !resposta.body) throw await erroDoDrive(resposta, "baixar o vídeo");
  const cabecalho = resposta.headers.get("content-length");
  let esperado = cabecalho && /^\d+$/.test(cabecalho) ? Number(cabecalho) : null;
  const parcial = `${destino}.parcial`;
  try {
    await pipeline(Readable.fromWeb(resposta.body as unknown as ReadableStreamDoNode), createWriteStream(parcial));
  } catch (erro) {
    await unlink(parcial).catch(() => undefined);
    // Erro com `syscall` veio do disco (sem espaço, sem permissão); o resto é a conexão que caiu.
    const doDisco = typeof (erro as NodeJS.ErrnoException)?.syscall === "string";
    throw doDisco
      ? new Error("Não deu para gravar a cópia temporária do vídeo no disco do hub (falta espaço?).", { cause: erro })
      : new ErroDoDrive("A conexão com o Google Drive caiu no meio do download do vídeo. Tente de novo.", 0, { cause: erro });
  }
  try {
    esperado ??= (await metadados(id))?.tamanho ?? null;
    const { size } = await stat(parcial);
    if (esperado !== null && size !== esperado) {
      throw new ErroDoDrive("O download do vídeo do Drive veio incompleto. Tente de novo.", 0);
    }
    await rename(parcial, destino);
    tamanhos.set(path.basename(destino), size);
  } catch (erro) {
    await unlink(parcial).catch(() => undefined);
    throw erro;
  }
}

// ---------- Limpeza da pasta temporária ----------

let ultimaLimpeza = 0;
let limpando: Promise<void> | null = null;

// No máximo a cada 10 minutos, em segundo plano: quem pediu o arquivo não espera a limpeza.
function agendarLimpeza(): void {
  if (limpando || Date.now() - ultimaLimpeza < DEZ_MINUTOS) return;
  ultimaLimpeza = Date.now();
  limparTemp().catch((erro) => console.error("[drive] limpeza da pasta temporária:", erro));
}

// Apaga as cópias sem uso há mais de 6 horas e, se o total passar de 20 GB, as mais antigas até caber.
// Os limites existem para os testes. Uma limpeza por vez.
export async function limparTemp(limites: { idadeMaximaMs?: number; tamanhoMaximo?: number } = {}): Promise<void> {
  while (limpando) await limpando.catch(() => undefined);
  limpando = limpar(limites.idadeMaximaMs ?? SEIS_HORAS, limites.tamanhoMaximo ?? VINTE_GB).finally(() => {
    limpando = null;
  });
  return limpando;
}

type Copia = { caminho: string; tamanho: number; usadaEm: number };

async function limpar(idadeMaximaMs: number, tamanhoMaximo: number): Promise<void> {
  ultimaLimpeza = Date.now();
  const nomes = await readdir(PASTA_TEMP).catch(() => [] as string[]);
  const agora = Date.now();
  const copias: Copia[] = [];
  for (const nome of nomes) {
    // Download em andamento: nem o ".parcial" nem a cópia final são tocados.
    if (baixando.has(nome.replace(/\.parcial$/, ""))) continue;
    const caminho = path.join(PASTA_TEMP, nome);
    const info = await stat(caminho).catch(() => null);
    if (info?.isFile()) copias.push({ caminho, tamanho: info.size, usadaEm: info.mtimeMs });
  }

  const ficaram: Copia[] = [];
  for (const copia of copias) {
    if (agora - copia.usadaEm > idadeMaximaMs && (await apagar(copia))) continue;
    ficaram.push(copia);
  }

  let total = ficaram.reduce((soma, c) => soma + c.tamanho, 0);
  for (const copia of ficaram.sort((a, b) => a.usadaEm - b.usadaEm)) {
    if (total <= tamanhoMaximo || agora - copia.usadaEm < CARENCIA) break;
    if (await apagar(copia)) total -= copia.tamanho;
  }
}

// Apaga se ninguém usou a cópia desde a listagem (baixarParaTemp atualiza a data a cada uso).
async function apagar(copia: Copia): Promise<boolean> {
  const info = await stat(copia.caminho).catch(() => null);
  if (!info || info.mtimeMs !== copia.usadaEm || baixando.has(path.basename(copia.caminho))) return false;
  try {
    await unlink(copia.caminho);
    tamanhos.delete(path.basename(copia.caminho));
    return true;
  } catch {
    return false; // aberta por outro programa (Windows) ou já apagada
  }
}

// ---------- Lixeira, nome e espelho ----------

export async function moverParaLixeira(id: string): Promise<void> {
  exigirId(id);
  const resposta = await chamarDrive(urlDoArquivo(id, "id"), { method: "PATCH", headers: JSON_UTF8, body: JSON.stringify({ trashed: true }) });
  // Já apagado de vez: o objetivo (sair do Drive) está cumprido.
  if (resposta.ok || resposta.status === 404) return descartar(resposta);
  throw await erroDoDrive(resposta, "mandar o vídeo para a lixeira");
}

export async function renomear(id: string, nome: string): Promise<void> {
  exigirId(id);
  const limpo = nome.trim();
  if (!limpo) throw new Error("O nome do arquivo no Drive não pode ficar vazio.");
  const resposta = await chamarDrive(urlDoArquivo(id, "id"), { method: "PATCH", headers: JSON_UTF8, body: JSON.stringify({ name: limpo }) });
  if (resposta.ok) return descartar(resposta);
  if (resposta.status === 404) {
    await descartar(resposta);
    throw new ArquivoForaDoDrive("Esse arquivo não está mais no Drive.");
  }
  throw await erroDoDrive(resposta, "renomear o arquivo");
}

// Dados de um arquivo; null se o Google não o encontra (apagado de vez). Outros erros lançam.
async function metadados(id: string): Promise<ArquivoDrive | null> {
  if (!idValido(id)) return null;
  const resposta = await chamarDrive(urlDoArquivo(id));
  if (resposta.status === 404) {
    await descartar(resposta);
    return null;
  }
  if (!resposta.ok) throw await erroDoDrive(resposta, "conferir os arquivos");
  return paraArquivo((await resposta.json()) as ArquivoDoGoogle);
}

// Situação atual de vários arquivos de uma vez (o espelho usa para achar apagados, na lixeira e renomeados).
// Ids que o Google não encontra (apagados de vez) não vêm no resultado. Qualquer outro erro (login vencido, sem
// permissão, Google fora) LANÇA: devolver uma lista vazia faria o espelho marcar tudo como apagado.
export async function situacao(ids: string[]): Promise<ArquivoDrive[]> {
  const unicos = [...new Set(ids)];
  const achados: (ArquivoDrive | null)[] = unicos.map(() => null);
  let proximo = 0;
  let falhou = false;
  const conferir = async () => {
    while (!falhou && proximo < unicos.length) {
      const i = proximo++;
      try {
        achados[i] = await metadados(unicos[i]);
      } catch (erro) {
        falhou = true;
        throw erro;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SIMULTANEOS, unicos.length) }, conferir));
  return achados.filter((a): a is ArquivoDrive => a !== null);
}
