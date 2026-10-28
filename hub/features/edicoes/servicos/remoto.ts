import "server-only";

import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import {
  entrada,
  TAMANHO_MINIMO_DA_CHAVE,
  VARIAVEL_DA_CHAVE,
  VARIAVEL_DO_ENDERECO,
  type SituacaoDoTrabalho,
  type Trabalho,
} from "@/features/edicoes/contrato";

// O lado do site na conversa com o servidor de edições (contrato.ts): manda as entradas, acompanha o registro e baixa o
// resultado. Se o servidor de edições reiniciar no meio (publicação nova, queda), o trabalho é mandado de novo; se o
// site reiniciar no meio, o trabalho continua lá e o site novo volta a acompanhar (rodar.ts).

// Primeiro pedido a um servidor que dormia: o Railway acorda o serviço e pode responder 502 até ele subir.
const PARA_ACORDAR_MS = 3 * 60_000;
// No meio de uma edição, fora do ar por mais que isto: a edição volta a rodar no site (rodar.ts).
const FORA_DO_AR_MS = 10 * 60_000;
const ENTRE_CONSULTAS_MS = 3000;
const MAXIMO_DE_ENVIOS = 3;

export const ajustesDoServidor = { entreConsultasMs: ENTRE_CONSULTAS_MS, paraAcordarMs: PARA_ACORDAR_MS, foraDoArMs: FORA_DO_AR_MS };

// Não deu para falar com o servidor de edições: quem chamou roda no próprio site.
export class ServidorForaDoAr extends Error {
  constructor(motivo: string) {
    super(`o servidor de edições não respondeu (${motivo})`);
    this.name = "ServidorForaDoAr";
  }
}

let avisouSemChave = false;

// Endereço e chave do servidor de edições; null = as edições rodam no próprio site.
export function servidorDeEdicoes(): { endereco: string; chave: string } | null {
  const endereco = process.env[VARIAVEL_DO_ENDERECO]?.trim().replace(/\/+$/, "");
  if (!endereco) return null;
  const chave = process.env[VARIAVEL_DA_CHAVE]?.trim() ?? "";
  if (chave.length < TAMANHO_MINIMO_DA_CHAVE) {
    if (!avisouSemChave) console.warn(`[edicoes] ${VARIAVEL_DO_ENDERECO} sem ${VARIAVEL_DA_CHAVE} (mínimo ${TAMANHO_MINIMO_DA_CHAVE} caracteres): as edições rodam no site.`);
    avisouSemChave = true;
    return null;
  }
  return { endereco, chave };
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const motivo = (err: unknown) => (err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)).slice(0, 120);

// Um pedido com novas tentativas enquanto o servidor não responde (dormindo, subindo, reiniciando) até `prazoMs`.
// O corpo vem de uma função porque um envio que falhou no meio precisa abrir o arquivo de novo.
async function pedir(
  caminho: string,
  init: { method?: string; corpo?: () => { body: BodyInit; tamanho?: number }; json?: unknown } = {},
  prazoMs = ajustesDoServidor.paraAcordarMs,
): Promise<Response> {
  const servidor = servidorDeEdicoes();
  if (!servidor) throw new ServidorForaDoAr("sem endereço");
  const ate = Date.now() + prazoMs;
  let espera = 1000;
  let ultimo = "";
  for (;;) {
    try {
      const headers: Record<string, string> = { authorization: `Bearer ${servidor.chave}` };
      let body: BodyInit | undefined;
      if (init.json !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(init.json);
      } else if (init.corpo) {
        const c = init.corpo();
        body = c.body;
        if (c.tamanho !== undefined) headers["content-length"] = String(c.tamanho);
      }
      const res = await fetch(`${servidor.endereco}${caminho}`, {
        method: init.method ?? "GET",
        headers,
        body,
        ...(body && init.corpo ? { duplex: "half" } : {}),
        // Envio e download de vídeo grande (centenas de MB) pela rede privada cabem com folga.
        signal: AbortSignal.timeout(15 * 60_000),
      } as RequestInit);
      // 502/503/504: o Railway ainda acordando o serviço (ou trocando de versão).
      if (res.status < 502 || res.status > 504) return res;
      ultimo = `HTTP ${res.status}`;
      await res.body?.cancel().catch(() => undefined);
    } catch (err) {
      ultimo = motivo(err);
      // Endereço que não existe (serviço apagado ou ainda sem nenhuma versão no ar): esperar não adianta.
      if ((err as { cause?: { code?: string } })?.cause?.code === "ENOTFOUND") throw new ServidorForaDoAr(ultimo);
    }
    if (Date.now() + espera > ate) throw new ServidorForaDoAr(ultimo);
    await esperar(espera);
    espera = Math.min(espera * 2, 15_000);
  }
}

async function lerJson<T>(res: Response): Promise<T> {
  const texto = await res.text();
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new Error(`resposta estranha do servidor de edições (HTTP ${res.status}): ${texto.slice(0, 120)}`);
  }
}

async function situacao(id: string, desde: number, prazoMs?: number): Promise<SituacaoDoTrabalho> {
  const res = await pedir(`/trabalhos/${id}?desde=${desde}`, {}, prazoMs);
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return { situacao: "desconhecido", log: "", fimDoLog: 0 };
  }
  if (!res.ok) throw new Error(`o servidor de edições recusou a consulta (HTTP ${res.status}): ${(await res.text()).slice(0, 160)}`);
  return lerJson<SituacaoDoTrabalho>(res);
}

async function enviarEntradas(id: string, locais: Record<string, string>) {
  for (const [nome, caminho] of Object.entries(locais)) {
    const { size } = await stat(caminho);
    const res = await pedir(`/trabalhos/${id}/entradas/${encodeURIComponent(nome)}`, {
      method: "PUT",
      corpo: () => ({ body: Readable.toWeb(createReadStream(caminho)) as unknown as BodyInit, tamanho: size }),
    });
    if (!res.ok) throw new Error(`o servidor de edições não recebeu ${nome} (HTTP ${res.status}): ${(await res.text()).slice(0, 160)}`);
    const { bytes } = await lerJson<{ bytes: number }>(res);
    if (bytes !== size) throw new Error(`${nome} chegou incompleto ao servidor de edições (${bytes} de ${size} bytes)`);
  }
}

async function comecar(id: string, trabalho: Trabalho): Promise<SituacaoDoTrabalho> {
  const res = await pedir(`/trabalhos/${id}`, { method: "POST", json: trabalho });
  if (!res.ok) throw new Error(`o servidor de edições recusou o trabalho (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  return lerJson<SituacaoDoTrabalho>(res);
}

// Baixa o vídeo pronto para `destino` (primeiro com outro nome; só fica com o nome certo se chegou inteiro).
async function baixarSaida(id: string, destino: string, bytes: number | undefined) {
  const parcial = `${destino}.parcial`;
  let erro: unknown;
  for (let vez = 0; vez < 3; vez++) {
    try {
      const res = await pedir(`/trabalhos/${id}/saida`);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(parcial));
      const { size } = await stat(parcial);
      if (bytes !== undefined && size !== bytes) throw new Error(`chegaram ${size} de ${bytes} bytes`);
      await rename(parcial, destino);
      return;
    } catch (err) {
      erro = err;
      await rm(parcial, { force: true }).catch(() => undefined);
    }
  }
  throw new Error(`não deu para trazer o vídeo pronto do servidor de edições (${motivo(erro)})`);
}

// Apaga a pasta do trabalho no servidor de edições (o que sobrar, ele mesmo apaga depois de umas horas).
export async function apagarNoServidor(id: string) {
  const res = await pedir(`/trabalhos/${id}`, { method: "DELETE" }, 30_000).catch(() => null);
  await res?.body?.cancel().catch(() => undefined);
}

// Falha da própria edição (o script, o ffmpeg ou o Remotion): rodar no site daria o mesmo erro.
export class FalhaNoServidorDeEdicoes extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "FalhaNoServidorDeEdicoes";
  }
}

// Roda o trabalho no servidor de edições e espera o fim. `registro` recebe o registro inteiro a cada novidade (a tela
// mostra). `saida`: onde o vídeo pronto fica no site (null quando o trabalho não gera vídeo, como a transcrição).
// Se o trabalho já está lá (o site reiniciou no meio), só volta a acompanhar.
// Lança ServidorForaDoAr quando não deu para falar com o servidor de edições (quem chamou decide rodar no site).
export async function rodarNoServidor(
  id: string,
  trabalho: Trabalho,
  locais: Record<string, string>,
  opts: { saida: string | null; registro?: (texto: string) => void; aoReenviar?: (vez: number) => void },
): Promise<{ resultado?: string }> {
  let envios = 0;
  let texto = "";
  let s = await situacao(id, 0);
  for (;;) {
    if (s.situacao === "desconhecido") {
      // Nunca chegou lá, ou o servidor de edições reiniciou no meio e perdeu o trabalho: manda de novo, do começo.
      if (++envios > MAXIMO_DE_ENVIOS) throw new FalhaNoServidorDeEdicoes("o servidor de edições reiniciou várias vezes no meio desta edição");
      if (envios > 1) opts.aoReenviar?.(envios);
      texto = "";
      await enviarEntradas(id, locais);
      s = await comecar(id, trabalho);
    }
    if (s.log) {
      texto += s.log;
      opts.registro?.(texto);
    }
    if (s.situacao === "pronto") {
      if (opts.saida) await baixarSaida(id, opts.saida, s.bytesDaSaida);
      await apagarNoServidor(id);
      return { resultado: s.resultado };
    }
    if (s.situacao === "falhou") {
      await apagarNoServidor(id);
      throw new FalhaNoServidorDeEdicoes(s.erro || "a edição falhou no servidor de edições");
    }
    await esperar(ajustesDoServidor.entreConsultasMs);
    s = await situacao(id, s.fimDoLog, ajustesDoServidor.foraDoArMs);
  }
}

// Whisper no servidor de edições: manda só o áudio (pequeno) e devolve a saída do script, como o Whisper local.
export async function transcreverNoServidor(audio: string): Promise<string> {
  const nome = `audio${path.extname(audio) || ".mp3"}`;
  const id = `transcricao-${randomUUID()}`;
  const { resultado } = await rodarNoServidor(id, { tipo: "transcricao", dados: { audio: entrada(nome) }, entradas: [nome] }, { [nome]: audio }, { saida: null });
  return resultado ?? "";
}
