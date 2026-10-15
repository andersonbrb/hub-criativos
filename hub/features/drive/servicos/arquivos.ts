import "server-only";

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, statfs, unlink, utimes } from "node:fs/promises";
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

// O disco do servidor não tem espaço para a cópia temporária agora (nem depois da limpeza). Passa sozinho quando
// outras cópias forem apagadas: quem chama mostra a mensagem como está.
export class SemEspacoNoServidor extends Error {
  constructor() {
    super("Sem espaço no servidor para trabalhar com esse vídeo agora. Tente de novo em alguns minutos.");
    this.name = "SemEspacoNoServidor";
  }
}

const CAMPOS = "id,name,mimeType,size,modifiedTime,trashed";
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
// O Google exige pedaços múltiplos de 256 KiB (menos o último).
export const MULTIPLO_DO_PEDACO = 256 * 1024;
export const TAMANHO_DO_PEDACO = 16 * MiB;
// Tentativas a mais em erro passageiro (5xx, 429, 408, limite de pedidos, rede): por pedaço no envio, por arquivo
// no download.
const MAX_TENTATIVAS = 5;
// Quantos arquivos o espelho confere ao mesmo tempo.
const SIMULTANEOS = 8;
// Downloads para a pasta temporária ao mesmo tempo. Uma montagem pede até 60 vídeos de uma vez: o resto espera a vez.
const MAX_DOWNLOADS = 3;

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

// O mesmo para um erro já traduzido: rede (status 0), Google instável ou o 403 de "muitos pedidos".
const LIMITE_DE_PEDIDOS = /^(rateLimitExceeded|userRateLimitExceeded)$/;
const passageiro = (erro: unknown) =>
  erro instanceof ErroDoDrive && (erro.status === 0 || retentavel(erro.status) || (erro.status === 403 && LIMITE_DE_PEDIDOS.test(erro.motivo)));

// Faz o pedido; se a rede cair, devolve null em vez de lançar (quem chamou decide se tenta de novo).
async function semCairNaRede(pedido: () => Promise<Response>): Promise<Response | null> {
  try {
    return await pedido();
  } catch (erro) {
    if (erro instanceof ErroDoDrive && erro.status === 0) return null;
    throw erro;
  }
}

// ---------- Memória do processo ----------
// Em globalThis, como conta.ts: o Next pode carregar este arquivo mais de uma vez (rotas compiladas à parte, recarga
// no desenvolvimento) e, com um estado por cópia do módulo, o mesmo vídeo seria baixado duas vezes e a fila de
// downloads valeria em dobro.

type Memoria = {
  // Tamanho esperado de cada cópia baixada (pelo nome do arquivo). Depois de reiniciar o servidor o mapa começa
  // vazio, e tudo bem: a cópia só ganha o nome final depois de conferida (até lá ela é ".parcial").
  tamanhos: Map<string, number>;
  // Uma promessa por arquivo: dois pedidos do mesmo vídeo ao mesmo tempo esperam o mesmo download.
  baixando: Map<string, Promise<string>>;
  // Downloads gravando agora (caminho do ".parcial" → tamanho final): o que ainda vai chegar entra na conta do espaço.
  reservas: Map<string, number>;
  // Conferências de espaço, uma por vez: duas ao mesmo tempo veriam o mesmo espaço livre e as duas reservariam.
  conferindoEspaco: Promise<void>;
  // Cópias em uso por um trabalho longo (caminho → prazos). Enquanto houver um prazo no futuro, a limpeza não apaga.
  segurados: Map<string, number[]>;
  // Vagas de download: `ativos` ocupadas; quem chega com as vagas cheias espera em `esperando`, por ordem.
  fila: { ativos: number; esperando: (() => void)[] };
  limpeza: { ultima: number; emCurso: Promise<void> | null };
};

const g = globalThis as typeof globalThis & { __hubDriveArquivos?: Memoria };
const memoria: Memoria = (g.__hubDriveArquivos ??= {
  tamanhos: new Map(),
  baixando: new Map(),
  reservas: new Map(),
  conferindoEspaco: Promise.resolve(),
  segurados: new Map(),
  fila: { ativos: 0, esperando: [] },
  limpeza: { ultima: 0, emCurso: null },
});

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
// `signal`: o do pedido do navegador. Quando o player fecha, o download do Google para junto.
export async function abrirTrecho(id: string, range: string | null, signal?: AbortSignal): Promise<Trecho> {
  exigirId(id);
  const faixa = faixaValida(range);
  const resposta = await chamarDrive(urlDoConteudo(id), { headers: { ...SEM_COMPRESSAO, ...(faixa ? { Range: faixa } : {}) }, signal });
  if (resposta.status === 416) {
    await descartar(resposta);
    const cabecalhos: Record<string, string> = { "Accept-Ranges": "bytes" };
    const tamanho =
      resposta.headers.get("content-range") ?? (await metadados(id, signal).then((f) => (f ? `bytes */${f.tamanho}` : null)).catch(() => null));
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
const VINTE_GB = 20 * GiB;
const DEZ_MINUTOS = 10 * 60 * 1000;
// Mesmo acima do limite de espaço, não apaga o que foi usado há menos de 1 hora: pode estar aberto no ffmpeg.
const CARENCIA = 60 * 60 * 1000;
// Espaço que fica livre no disco para o resto do hub (banco, mídia, logs) mesmo com uma cópia grande chegando.
const FOLGA_NO_DISCO = 2 * GiB;

// Baixa para uma pasta temporária (com cache por id) e devolve o caminho local. Para ffmpeg, Python e envios.
// No máximo 3 downloads ao mesmo tempo: os outros esperam a vez (sem falhar).
export async function baixarParaTemp(id: string, extensao: string): Promise<string> {
  exigirId(id);
  const ext = extensao.replace(/^\./, "").toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(ext)) throw new Error(`Extensão inválida para a cópia do Drive: "${extensao}".`);
  const nome = `${id}.${ext}`;
  const emAndamento = memoria.baixando.get(nome);
  if (emAndamento) return emAndamento;
  const promessa = (async () => {
    const destino = path.join(PASTA_TEMP, nome);
    if (await copiaCompleta(destino)) {
      // Marca o uso: a limpeza apaga o que ficou sem uso há mais de 6 horas.
      const agora = new Date();
      await utimes(destino, agora, agora).catch(() => undefined);
    } else {
      await naVez(() => baixar(id, destino));
    }
    return destino;
  })().finally(() => {
    memoria.baixando.delete(nome);
    agendarLimpeza();
  });
  memoria.baixando.set(nome, promessa);
  return promessa;
}

// Ocupa uma vaga de download (ou espera uma) enquanto `tarefa` roda. Ao terminar, a vaga passa direto para o
// próximo da fila.
async function naVez<T>(tarefa: () => Promise<T>): Promise<T> {
  const fila = memoria.fila;
  if (fila.ativos < MAX_DOWNLOADS) fila.ativos++;
  else await new Promise<void>((vez) => fila.esperando.push(vez));
  try {
    return await tarefa();
  } finally {
    const proximo = fila.esperando.shift();
    if (proximo) proximo();
    else fila.ativos--;
  }
}

async function copiaCompleta(destino: string): Promise<boolean> {
  const info = await stat(destino).catch(() => null);
  if (!info?.isFile()) return false;
  const esperado = memoria.tamanhos.get(path.basename(destino));
  if (esperado === undefined || info.size === esperado) return true;
  await unlink(destino).catch(() => undefined);
  memoria.tamanhos.delete(path.basename(destino));
  return false;
}

// Baixa com novas tentativas em erro passageiro (Google instável, pausa pedida, rede caiu no meio), esperando mais
// a cada falha, como o envio. Arquivo apagado, login recusado, disco cheio ou sem espaço: desiste na hora.
async function baixar(id: string, destino: string): Promise<void> {
  await mkdir(PASTA_TEMP, { recursive: true });
  for (let falhas = 0; ; ) {
    try {
      return await baixarUmaVez(id, destino);
    } catch (erro) {
      if (falhas >= MAX_TENTATIVAS || !passageiro(erro)) throw erro;
      falhas += 1;
      await esperar(falhas);
    }
  }
}

async function baixarUmaVez(id: string, destino: string): Promise<void> {
  const resposta = await chamarDrive(urlDoConteudo(id), { headers: SEM_COMPRESSAO });
  if (resposta.status === 404) {
    await descartar(resposta);
    throw new ArquivoForaDoDrive();
  }
  if (!resposta.ok || !resposta.body) throw await erroDoDrive(resposta, "baixar o vídeo");
  const parcial = `${destino}.parcial`;
  const esperado = await tamanhoQueVemDoGoogle(id, resposta).catch(async (erro: unknown) => {
    await descartar(resposta);
    throw erro;
  });
  await reservarEspaco(parcial, esperado).catch(async (erro: unknown) => {
    await descartar(resposta);
    throw erro;
  });
  try {
    await gravar(resposta.body, parcial);
    const { size } = await stat(parcial);
    if (esperado !== null && size !== esperado) {
      throw new ErroDoDrive("O download do vídeo do Drive veio incompleto. Tente de novo.", 0);
    }
    await rename(parcial, destino);
    memoria.tamanhos.set(path.basename(destino), size);
  } catch (erro) {
    await unlink(parcial).catch(() => undefined);
    throw erro;
  } finally {
    memoria.reservas.delete(parcial);
  }
}

// Tamanho do arquivo: o Content-Length da resposta ou, sem ele, o `size` do Drive. null se nenhum dos dois veio.
async function tamanhoQueVemDoGoogle(id: string, resposta: Response): Promise<number | null> {
  const cabecalho = resposta.headers.get("content-length");
  if (cabecalho && /^\d+$/.test(cabecalho)) return Number(cabecalho);
  return (await metadados(id))?.tamanho ?? null;
}

async function gravar(corpo: ReadableStream<Uint8Array>, parcial: string): Promise<void> {
  try {
    await pipeline(Readable.fromWeb(corpo as unknown as ReadableStreamDoNode), createWriteStream(parcial));
  } catch (erro) {
    // Erro com `syscall` veio do disco (sem espaço, sem permissão); o resto é a conexão que caiu.
    const doDisco = typeof (erro as NodeJS.ErrnoException)?.syscall === "string";
    throw doDisco
      ? new Error("Não deu para gravar a cópia temporária do vídeo no disco do hub (falta espaço?).", { cause: erro })
      : new ErroDoDrive("A conexão com o Google Drive caiu no meio do download do vídeo. Tente de novo.", 0, { cause: erro });
  }
}

// ---------- Espaço no disco ----------

// Bytes livres no disco da pasta temporária. null se não der para medir (aí valem só os limites fixos).
async function espacoLivre(): Promise<number | null> {
  try {
    const disco = await statfs(PASTA_TEMP);
    return Number(disco.bavail) * Number(disco.bsize);
  } catch {
    return null;
  }
}

// Reserva no disco o que vai chegar. Se não couber deixando 2 GB livres, roda a limpeza; se ainda não couber,
// recusa antes de gravar qualquer coisa. Os downloads em andamento entram na conta pelo que ainda falta chegar.
function reservarEspaco(parcial: string, tamanho: number | null): Promise<void> {
  if (tamanho === null) return Promise.resolve();
  const vez = memoria.conferindoEspaco.then(async () => {
    let falta = await faltaNoDisco(parcial, tamanho);
    if (falta > 0) {
      await limparTemp({ liberar: falta });
      falta = await faltaNoDisco(parcial, tamanho);
    }
    if (falta > 0) throw new SemEspacoNoServidor();
    memoria.reservas.set(parcial, tamanho);
  });
  memoria.conferindoEspaco = vez.catch(() => undefined);
  return vez;
}

// Quantos bytes faltam no disco para gravar `tamanho` e ainda sobrar a folga. Zero ou menos: cabe.
// O que os outros já gravaram é medido ANTES do espaço livre: o que eles gravarem entre as duas medidas conta duas
// vezes (erra para o lado seguro) em vez de não contar nenhuma.
async function faltaNoDisco(parcial: string, tamanho: number): Promise<number> {
  let aCaminho = 0;
  for (const [outro, esperado] of [...memoria.reservas]) {
    if (outro === parcial) continue;
    const gravado = (await stat(outro).catch(() => null))?.size ?? 0;
    aCaminho += Math.max(0, esperado - gravado);
  }
  const livre = await espacoLivre();
  if (livre === null) return 0;
  return tamanho + FOLGA_NO_DISCO - (livre - aCaminho);
}

// Teto da pasta temporária: 20 GB ou metade do espaço que ela tem à disposição (o que já ocupa + o livre no disco),
// o que for menor. Num volume pequeno, ou quando o resto do hub cresce, o teto baixa e as cópias velhas saem antes
// de o disco encher.
async function tetoDaPasta(ocupado: number): Promise<number> {
  const livre = await espacoLivre();
  return livre === null ? VINTE_GB : Math.min(VINTE_GB, (ocupado + livre) / 2);
}

// ---------- Cópias em uso por muito tempo ----------

// Marca a cópia temporária como em uso até agora + `ms` (montagem e remover legenda passam horas lendo o vídeo).
// Enquanto isso a limpeza não a apaga, nem pela idade nem pelo espaço. Pode ser chamada por vários trabalhos.
export function segurarTemp(caminho: string, ms: number): void {
  if (Number.isNaN(ms)) return;
  const chave = path.resolve(caminho);
  const prazos = memoria.segurados.get(chave) ?? [];
  prazos.push(Date.now() + Math.max(0, ms));
  memoria.segurados.set(chave, prazos);
}

// Solta uma das marcas de segurarTemp (a que vence primeiro: as dos outros trabalhos continuam valendo pelo prazo
// mais longo). Sem marca nenhuma, a cópia volta às regras normais da limpeza.
export function soltarTemp(caminho: string): void {
  const chave = path.resolve(caminho);
  const prazos = vigentes(chave);
  prazos.shift();
  if (prazos.length) memoria.segurados.set(chave, prazos);
  else memoria.segurados.delete(chave);
}

// Prazos ainda no futuro, do que vence primeiro ao que vence por último.
const vigentes = (chave: string) => (memoria.segurados.get(chave) ?? []).filter((prazo) => prazo > Date.now()).sort((a, b) => a - b);

function segurada(caminho: string): boolean {
  const chave = path.resolve(caminho);
  const prazos = vigentes(chave);
  if (prazos.length) memoria.segurados.set(chave, prazos);
  else memoria.segurados.delete(chave);
  return prazos.length > 0;
}

// ---------- Limpeza da pasta temporária ----------

// No máximo a cada 10 minutos, em segundo plano: quem pediu o arquivo não espera a limpeza.
function agendarLimpeza(): void {
  const limpeza = memoria.limpeza;
  if (limpeza.emCurso || Date.now() - limpeza.ultima < DEZ_MINUTOS) return;
  limpeza.ultima = Date.now();
  limparTemp().catch((erro) => console.error("[drive] limpeza da pasta temporária:", erro));
}

type Limites = {
  idadeMaximaMs?: number;
  // Fixo, para os testes. Sem ele vale o teto pelo espaço livre (tetoDaPasta).
  tamanhoMaximo?: number;
  // Bytes que precisam ficar livres (um download grande chegando): apaga as mais antigas até liberar.
  liberar?: number;
};

// Apaga as cópias sem uso há mais de 6 horas e, se o total passar do teto, as mais antigas até caber. Nunca toca no
// que está sendo baixado, no que está segurado nem no que foi usado há menos de 1 hora. Uma limpeza por vez.
export async function limparTemp(limites: Limites = {}): Promise<void> {
  const limpeza = memoria.limpeza;
  while (limpeza.emCurso) await limpeza.emCurso.catch(() => undefined);
  const rodada = limpar(limites).finally(() => {
    limpeza.emCurso = null;
  });
  limpeza.emCurso = rodada;
  return rodada;
}

type Copia = { caminho: string; tamanho: number; usadaEm: number; intocavel: boolean };

// Download em andamento (nem o ".parcial" nem a cópia final) ou cópia segurada.
const intocavel = (caminho: string) => memoria.baixando.has(path.basename(caminho).replace(/\.parcial$/, "")) || segurada(caminho);

async function limpar(limites: Limites): Promise<void> {
  memoria.limpeza.ultima = Date.now();
  const nomes = await readdir(PASTA_TEMP).catch(() => [] as string[]);
  const agora = Date.now();
  const copias: Copia[] = [];
  for (const nome of nomes) {
    const caminho = path.join(PASTA_TEMP, nome);
    const info = await stat(caminho).catch(() => null);
    if (info?.isFile()) copias.push({ caminho, tamanho: info.size, usadaEm: info.mtimeMs, intocavel: intocavel(caminho) });
  }
  if (!copias.length) return;

  const idadeMaxima = limites.idadeMaximaMs ?? SEIS_HORAS;
  const ficaram: Copia[] = [];
  for (const copia of copias) {
    if (!copia.intocavel && agora - copia.usadaEm > idadeMaxima && (await apagar(copia))) continue;
    ficaram.push(copia);
  }

  // As intocáveis contam no total (ocupam o disco), mas só as outras podem sair.
  let total = ficaram.reduce((soma, c) => soma + c.tamanho, 0);
  const teto = limites.tamanhoMaximo ?? (await tetoDaPasta(total));
  let liberar = limites.liberar ?? 0;
  for (const copia of ficaram.sort((a, b) => a.usadaEm - b.usadaEm)) {
    if ((total <= teto && liberar <= 0) || agora - copia.usadaEm < CARENCIA) break;
    if (copia.intocavel || !(await apagar(copia))) continue;
    total -= copia.tamanho;
    liberar -= copia.tamanho;
  }
}

// Apaga se ninguém usou a cópia desde a listagem (baixarParaTemp atualiza a data a cada uso) e se ela não passou a
// ser baixada ou segurada nesse meio-tempo.
async function apagar(copia: Copia): Promise<boolean> {
  const info = await stat(copia.caminho).catch(() => null);
  if (!info || info.mtimeMs !== copia.usadaEm || intocavel(copia.caminho)) return false;
  try {
    await unlink(copia.caminho);
    memoria.tamanhos.delete(path.basename(copia.caminho));
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
async function metadados(id: string, signal?: AbortSignal): Promise<ArquivoDrive | null> {
  if (!idValido(id)) return null;
  const resposta = await chamarDrive(urlDoArquivo(id), { signal });
  if (resposta.status === 404) {
    await descartar(resposta);
    return null;
  }
  if (!resposta.ok) throw await erroDoDrive(resposta, "conferir os arquivos");
  return paraArquivo((await resposta.json()) as ArquivoDoGoogle);
}

// Todos os arquivos que o hub guardou no Drive (marcados com appProperties hub=1), inclusive os da lixeira, numa
// listagem paginada de 1000 em 1000. O que foi apagado de vez não vem. Qualquer erro (login vencido, sem permissão,
// rede) LANÇA: devolver uma lista vazia faria o espelho marcar tudo como apagado.
export async function listarArquivosDoHub(): Promise<ArquivoDrive[]> {
  const achados: ArquivoDrive[] = [];
  let pagina: string | undefined;
  do {
    const busca = new URLSearchParams({
      q: "appProperties has { key='hub' and value='1' }",
      fields: `nextPageToken,files(${CAMPOS})`,
      pageSize: "1000",
    });
    if (pagina) busca.set("pageToken", pagina);
    const resposta = await chamarDrive(`${API_DRIVE}/files?${busca}`);
    if (!resposta.ok) throw await erroDoDrive(resposta, "listar os vídeos do hub");
    const lista = (await resposta.json()) as { nextPageToken?: string; files?: ArquivoDoGoogle[] };
    for (const arquivo of lista.files ?? []) achados.push(paraArquivo(arquivo));
    pagina = lista.nextPageToken || undefined;
  } while (pagina);
  return achados;
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
